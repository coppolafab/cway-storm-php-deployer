# storm.dev PHP deployer

A plugin for [storm.dev](https://storm.dev) nodes to deploy PHP projects.

## Installation
You can install the plugin directly from the storm.dev dashboard.

### Manual install
* cd into ${path_to_storm_node}/storm_modules/custom/
* ```git clone https://github.com/coppolafab/cway-storm-php-deployer.git && cd cway-storm-php-deployer.git && npm install --production```
* create a new plugin command on storm.dev as 'cway-storm-php-deployer'

## Documentation

### How it works

The first step is to download the new code: ```git archive``` will be used for the job. Via the ```.gitattributes``` file, read from the current working directory, you can specify files and directories to exclude from the export.<br>In this way you are able to minimize the download size (and time) of a new deploy, with only the necessary code.

During the second step, the archive will be extracted and the project tree re-created. You can exclude files or directory during the process, for example to not override a storage directory not excluded by ```.gitattributes```. The new code is stored in a new directory and will not be activated until the last step.

After the extraction, you are able to symlink some files or directories not in the repository, from a project path to the new deployed directory, for example to link the .env file or the storage directory. 

Then, the composer install (or a custom command) will be executed, installing the dependencies and/or other specified tasks.

At this stage you have a new directory with all the required code ready, but it is not active yet. Servers will wait until all will be ready. Once done, a symlink, from where the Web server is serving the project (es. /var/www/html/current), will be swapped to point to the new deployed directory.

Your new code is ready now and the web server is using it, but you can customize more things. A custom composer command can be executed, for example to restart the PHP-FPM server, or to restart your queue workers.

Finally you can configure a clean up strategy, to delete older deplyoments directory.

### Workspace

Create a new workspace, or use an existing one, then add all the nodes where you need to receive deployments.
Install this plugin on every node.

### Plugin command

Create a new plugin command on each node, with the following arguments:

Argument | Description
--- | ---
REPOSITORY_URL | Required. SSH URL of the repository.
DEPLOYMENTS_DIRECTORY | Required. Directory where all deployments will be stored. It will be created recursively if not exists. Default: ./.cway-storm-php-deployer.
GIT_ARCHIVE_TREEISH | Required. GIT Commit, Branch, Tag or any Tree-ish to export. Default: HEAD.
TAR_EXTRACT_EXCLUDE_PATHS | Optional. Comma-separated list of files and directories to exclude from the extraction.
PROJECT_PATH | Optional. Required when PROJECT_MANAGED_SYMLINKS is used. Base path of the directory where managed symlinks will be resolved.
PROJECT_MANAGED_SYMLINKS | Optional. Comma-separated list of files and directories to symlink from PROJECT_PATH to the new deploy.
COMPOSER_PATH | Required. PHP Composer executable path. Default: composer.
COMPOSER_COMMAND | Required. Composer command to execute after code download. Default: install.
WAIT_ALL_SERVERS | Required. Sync the deploy activation on all servers. Default: true.
CURRENT_SYMLINK_PATH | Required. Link path from where the web server is serving the project.
COMPOSER_POST_ACTIVATION_COMMAND | Optional. Composer command to execute after deploy activation.
N_DEPLOYMENTS_TO_RETAIN | Required. Number of deployments directory to retain. Default: 0 (retain all)

### Workflow

Create a new workflow on the previously selected workspace, and configure the following elements:
* a button or an endpoint to start it
* connect a plugin command to the previous element for each node
* after each plugin command, connect a Decision element, to check if $.DEPLOY_PHASE === 'ACTIVATE'
* connect each Decision element to an AND Logical operator
* if true, connect a new plugin command for each node, using the previous outputs as arguments
* you are done! if needed add more elements to receive a notification when finished

See the image in docs/assets for an example workflow.