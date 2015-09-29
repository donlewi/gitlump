/// <reference path="../typings/tsd.d.ts" />

import * as fs from "fs";
import * as colors from "ansicolors";

import * as utils from "./utils";
import * as errors from "./errors";
import * as prompt from "./prompt";
import ConfigManager from "./ConfigManager";

import {AuthInfo, RepositoryConfig, AppConfig, GitRepository, CloneConfig} from "./interfaces";
import GitHubConnection from "./GitHubConnection";
import * as GitCommands from "./GitCommands";

var CONFIG_FILENAME = ".gitlump.json";

function execGitClone(path: string, args: CloneConfig[]): Promise<void> {
    var index = 0;
    return new Promise<void>((resolve, reject) => {
        var execFunc = (path: string, url: string, directory: string, name: string) => {
            var startMessage = `clone ${name} into ${directory}`;
            console.log(startMessage);
            GitCommands.clone(path, url, directory).then(() => {
                process.stdout.write("\u001B[1A\u001B[" + startMessage.length + "C");
                console.log(" ... done");
                index++;
                if (index < args.length) {
                    var arg = args[index];
                    execFunc(path, arg.url, arg.directory, arg.name);
                } else {
                    resolve();
                }
            }).catch((error) => {
                reject(error);
            });
        };
        execFunc(path, args[0].url, args[0].directory, args[0].name);
    });
}

function execGitPull(dirs: string[]): Promise<void> {
    var index = 0;
    return new Promise<void>((resolve, reject) => {
        var execFunc = (path: string) => {
            var startMessage = `pull in ${path}`;
            console.log(startMessage);
            GitCommands.pull(path).then((result) => {
                process.stdout.write("\u001B[1A\u001B[" + startMessage.length + "C");
                console.log(" ... done");
                console.log(result.stdout);
                index++;
                if (index < dirs.length) {
                    execFunc(dirs[index]);
                } else {
                    resolve();
                }
            }).catch((error) => {
                reject(error);
            });
        };
        execFunc(dirs[0]);
    });
}

// gitlump create
export function create(type: string, name: string): void {
    var manager: ConfigManager = null;
    ConfigManager.createConfig(type, name).then((config) => {
        manager = new ConfigManager(config);
        return utils.mkdir(name);
    }).then(() => {
        return manager.writeToFile(`./${name}/${CONFIG_FILENAME}`);
    }).then(() => {
        console.log("done");
    }).catch((error) => {
        utils.exitWithError(error);
    });
}

// gitlump init
export function init(type: string, name: string): void {
    var manager: ConfigManager = null;
    ConfigManager.createConfig(type, name).then((config) => {
        manager = new ConfigManager(config);
        return manager.writeToFile(`./${CONFIG_FILENAME}`);
    }).then(() => {
        console.log("done");
    }).catch((error) => {
        utils.exitWithError(error);
    });
}

// gitlump clone
export function clone(arg?: {auth: AuthInfo}): void {
    var manager = new ConfigManager();
    var config: AppConfig = null;
    var cloned: string[] = [];
    manager.loadFromFile(`./${CONFIG_FILENAME}`).then(() => {
        config = manager.config;
        var gh = new GitHubConnection(config.endpoint);
        if (arg && arg.auth) {
            gh.auth(arg.auth.username, arg.auth.password);
        }
        return gh.getRepositories(config.type, config.name);
    }).then((list: GitRepository[]) => {
        var cloneArgs: CloneConfig[] = [];
        for (var i = 0; i < list.length; i++) {
            var repo = list[i];
            if (!manager.ignored(repo.name)) {
                cloned.push(repo.name);
                if (!manager.cloned(repo.name)) {
                    cloneArgs.push(manager.cloneConfig(repo));
                }
            }
        }
        if (cloneArgs.length) {
            return execGitClone(".", cloneArgs);
        } else {
            console.log("No new repositories.");
            process.exit();
        }
    }).then(() => {
        config.cloned = cloned;
        return manager.writeToFile(`./${CONFIG_FILENAME}`);
    }).then(() => {
        // done
    }).catch((error: errors.BaseError) => {
        if ((error instanceof errors.AuthFailedError)
            || (error instanceof errors.AuthRequiredError)) {
            var message: string = null;
            if (error instanceof errors.AuthFailedError) {
                message = "Authentication is failed.";
            } else {
                message = `Authentication is required by ${manager.config.endpoint}.`;
            }
            console.log(message);
            prompt.auth().then((value: AuthInfo) => {
                clone({auth: value});
            }).catch((error: errors.BaseError) => {
                utils.exitWithError(error);
            });
        } else {
            utils.exitWithError(error);
        }
    });
}

// gltlump pull
export function pull(): void {
    var manager = new ConfigManager();
    var config: AppConfig = null;
    manager.loadFromFile(`./${CONFIG_FILENAME}`).then(() => {
        var dirs = manager.clonedDirectories();
        return execGitPull(dirs);
    }).catch((error: errors.BaseError) => {
        utils.exitWithError(error);
    })
}

// gitlump exec
export function exec(command: string): void {
    utils.exitWithError(new errors.NotImplementedError());
}
