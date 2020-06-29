const path = require('path');
const fs = require('fs');
const child_process = require('child_process');

const defaultArgs = {
  REPOSITORY_URL: process.env.REPOSITORY_URL || null,
  DEPLOYMENTS_DIRECTORY: process.env.DEPLOYMENTS_DIRECTORY || '.cway-storm-php-deployer',
  GIT_ARCHIVE_TREEISH: process.env.GIT_ARCHIVE_TREEISH || 'HEAD',
  TAR_EXTRACT_EXCLUDE_PATHS: process.env.TAR_EXTRACT_EXCLUDE_PATHS || null,
  CURRENT_SYMLINK_PATH: process.env.CURRENT_SYMLINK_PATH || null,
  PROJECT_PATH: process.env.PROJECT_PATH || null,
  PROJECT_MANAGED_SYMLINKS: process.env.PROJECT_MANAGED_SYMLINKS || null,
  COMPOSER_PATH: process.env.COMPOSER_PATH || 'composer',
  COMPOSER_COMMAND: process.env.COMPOSER_COMMAND || 'install',
  COMPOSER_POST_ACTIVATION_COMMAND: process.env.COMPOSER_POST_ACTIVATION_COMMAND || null,
  N_DEPLOYMENTS_TO_RETAIN: process.env.N_DEPLOYMENTS_TO_RETAIN || 0,
  DEPLOY_PHASE: 'GIT_ARCHIVE',
  WAIT_ALL_SERVERS: process.env.WAIT_ALL_SERVERS || true,
};

module.exports = {
  setArguments: function (args) {
    this.args = Object.assign({}, defaultArgs, args);
    this.args.WAIT_ALL_SERVERS = Boolean(this.args.WAIT_ALL_SERVERS);
    const toRetain = Number.parseInt(this.args.N_DEPLOYMENTS_TO_RETAIN, 10);
    this.args.N_DEPLOYMENTS_TO_RETAIN = Math.max(0, Number.isNaN(toRetain) ? 0 : toRetain);
  },

  run: function () {
    return new Promise((resolve, reject) => {
      try {
        const result = {};

        switch (this.args.DEPLOY_PHASE) {
          case 'GIT_ARCHIVE':
            const commitDir = path.join(this.args.DEPLOYMENTS_DIRECTORY, String(Date.now()));
  
            try {
              fs.mkdirSync(commitDir, { recursive: true });
            } catch (e) {
              if (e.code !== 'EEXIST') {
                throw e;
              }
            }
  
            const gitArchive = child_process.spawn('git', [
              'archive',
              '--format=tar',
              '--remote',
              this.args.REPOSITORY_URL,
              '--worktree-attributes',
              this.args.GIT_ARCHIVE_TREEISH,
            ], {
              cwd: commitDir
            });
  
            const tarExtractArgs = ['-x'];
  
            if (this.args.TAR_EXTRACT_EXCLUDE_PATHS) {
              tarExtractArgs.push(...this.args.TAR_EXTRACT_EXCLUDE_PATHS.split(',').map(s => `--exclude=${s}`));
            }
  
            const tarExtract = child_process.spawn('tar', tarExtractArgs, {
              cwd: commitDir
            });
  
            gitArchive.stdout.on('data', (data) => {
              tarExtract.stdin.write(data);
            });
  
            gitArchive.once('close', (code) => {
              result.gitArchiveStatusCode = code;
  
              if (code !== 0) {
                return resolve(result);
              }
  
              tarExtract.stdin.end();
            });
  
            tarExtract.once('exit', (code) => {
              result.tarExtractStatusCode = code;
  
              if (code !== 0) {
                return resolve(result);
              }
  
              this.doProjectSymlinks(commitDir);
  
              if (this.args.COMPOSER_COMMAND) {
                const composerInstall = child_process.spawnSync(this.args.COMPOSER_PATH, [
                  this.args.COMPOSER_COMMAND,
                  '--no-ansi',
                  '--no-interaction',
                  '--no-plugins',
                  '--no-dev',
                  '--no-progress',
                  '--no-suggest'
                ], {
                  cwd: commitDir
                });
  
                result.composerInstallStatusCode = composerInstall.status;
  
                if (composerInstall.status !== 0) {
                  return resolve(result);
                }
              }
  
              if (this.args.WAIT_ALL_SERVERS) {
                result.commitDir = commitDir;
                result.DEPLOY_PHASE = 'ACTIVATE';
                return resolve(result);
              } else {
                this.doAfterInstall(commitDir, result);
                return resolve(result);
              }
            });
  
            break;
          case 'ACTIVATE':
            this.doAfterInstall(this.args.commitDir, result);
            return resolve(result);
          default:
            return reject({
              error_message: 'wrong arguments'
            });
        }
      } catch (e) {
        reject({
          error: e.toString()
        });
      }
    });
  },

  doProjectSymlinks: function (commitDir) {
    if (this.args.PROJECT_MANAGED_SYMLINKS) {
      this.args.PROJECT_MANAGED_SYMLINKS.split(',').forEach(src_path => {
        const dest_path = path.join(commitDir, src_path);

        if (!fs.existsSync(dest_path)) {
          fs.symlinkSync(path.resolve(this.args.PROJECT_PATH, src_path), dest_path);
        }
      });
    }
  },

  doActivate: function (commitDir, result) {
    const tmpPath = this.args.CURRENT_SYMLINK_PATH + '.tmp';

    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }

    fs.symlinkSync(commitDir, tmpPath);
    fs.renameSync(tmpPath, this.args.CURRENT_SYMLINK_PATH);
    result.DEPLOY_PHASE = 'ACTIVATED';

    if (this.args.COMPOSER_POST_ACTIVATION_COMMAND) {
      const composerAfterActivation = child_process.spawnSync(this.args.COMPOSER_PATH, [
        this.args.COMPOSER_POST_ACTIVATION_COMMAND,
        '--no-ansi',
        '--no-interaction',
        '--no-plugins',
      ], {
        cwd: commitDir
      });

      result.composerAfterActivationCode = composerAfterActivation.status;
    }
  },

  cleanupDeployments: function () {
    if (this.args.N_DEPLOYMENTS_TO_RETAIN === 0) {
      return;
    }

    const deployments = fs.readdirSync(this.args.DEPLOYMENTS_DIRECTORY);

    if (deployments.length <= this.args.N_DEPLOYMENTS_TO_RETAIN) {
      return;
    }

    const dirsToDelete = deployments.slice(0, deployments.length - this.args.N_DEPLOYMENTS_TO_RETAIN);

    dirsToDelete.forEach((dir) => {
      deleteDirectoryRecursive(path.join(this.args.DEPLOYMENTS_DIRECTORY, dir));
    });
  },

  doAfterInstall: function (commitDir, result) {
    this.doActivate(commitDir, result);

    if (result.DEPLOY_PHASE === 'ACTIVATED') {
      this.cleanupDeployments();
    }
  },

};

function deleteDirectoryRecursive(pathToDelete) {
  if (fs.existsSync(pathToDelete)) {
    fs.readdirSync(pathToDelete).forEach((file, index) => {
      const curPath = path.join(pathToDelete, file);

      if (fs.lstatSync(curPath).isDirectory()) {
        deleteDirectoryRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });

    fs.rmdirSync(pathToDelete);
  }
};

