/// <reference path="../typings/tsd.d.ts" />

import * as fs from "fs";
import * as colors from "colors";

import * as utils from "./utils";
import * as errors from "./errors";
import * as prompt from "./prompt";
import * as gitCommands from "./gitCommands";
import ConfigManager from "./ConfigManager";

import {AuthInfo, RepositoryConfig, AppConfig, GitRepository, CloneConfig} from "./interfaces";
import GitHubConnection from "./GitHubConnection";

var CONFIG_FILENAME = ".gitlump.json";

function _clone(path: string, args: CloneConfig[]): Promise<void> {
    var index = 0;
    return new Promise<void>((resolve, reject) => {
        var execFunc = (path: string, url: string, directory: string, name: string) => {
            var startMessage = `clone ${name}`;
            if (name !== directory) {
                startMessage += ` into \'${directory}\'`;
            }
            console.log(startMessage);
            gitCommands.clone(path, url, directory).then(() => {
                process.stdout.write("\u001B[1A");
                console.log(`${startMessage} ... done`);
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

function _exec(dirs: string[], command: string): Promise<void> {
    var index = 0;
    return new Promise<void>((resolve, reject) => {
        var next = () => {
            index++;
            if (index < dirs.length) {
                execFunc(dirs[index]);
            } else {
                resolve();
            }
        };
        var execFunc = (path: string) => {
            var startMessage = `>> git ${command} in \'${path}\'`;
            console.log(colors["green"](startMessage));
            gitCommands.exec(path, command).then((result) => {
                console.log(result.stdout);
                next();
            }).catch((error: errors.GitCommandExecError) => {
                console.log(colors["red"]("[ERROR] ") + error.message);
                if (error.stderr) {
                    console.log(error.stderr);
                }
                next();
            });
        };
        execFunc(dirs[0]);
    });
}

function _accessToken(manager: ConfigManager): string {
    let accessToken = manager.accessToken();
    if (manager.config.useAccessToken && !accessToken) {
        console.log("access token is empty.");
    }
    return accessToken;
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
        var gh = new GitHubConnection(config.endpoint, _accessToken(manager));
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
            return _clone(".", cloneArgs);
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
        return _exec(dirs, "pull");
    }).catch((error: errors.BaseError) => {
        utils.exitWithError(error);
    })
}

// gitlump exec
export function exec(command: string): void {
    var manager = new ConfigManager();
    manager.loadFromFile(`./${CONFIG_FILENAME}`).then(() => {
        var dirs = manager.clonedDirectories();
        return _exec(dirs, command);
    }).catch((error: errors.BaseError) => {
        utils.exitWithError(error);
    })
}

// gitlump ls
export function ls(): void {
    var manager = new ConfigManager();
    var config: AppConfig = null;
    manager.loadFromFile(`./${CONFIG_FILENAME}`).then(() => {
        return utils.gitDirectoryList(".");
    }).then((gitDirectoryList) => {
        var cloned = manager.config.cloned;
        cloned.sort();
        cloned.forEach((repoName) => {
            var c = manager.repositoryConfig(repoName);
            var message = repoName;
            var directory = repoName;
            if (c && c.directory) {
                message += ` (${c.directory})`;
                directory = c.directory;
            }
            if (gitDirectoryList.indexOf(directory) === -1) {
                message += " -- " + colors.red("does not exist as git directory");
            }
            console.log(message);
        });
    }).catch((error: errors.BaseError) => {
        utils.exitWithError(error);
    })
}

// gitlump ls
export function lsRemote(arg?: {auth: AuthInfo}): void {
    var manager = new ConfigManager();
    var config: AppConfig = null;
    var cloned: string[] = [];
    manager.loadFromFile(`./${CONFIG_FILENAME}`).then(() => {
        config = manager.config;
        var gh = new GitHubConnection(config.endpoint, _accessToken(manager));
        if (arg && arg.auth) {
            gh.auth(arg.auth.username, arg.auth.password);
        }
        return gh.getRepositories(config.type, config.name);
    }).then((list: GitRepository[]) => {
        var cloned = config.cloned;
        for (var i = 0; i < list.length; i++) {
            var r = list[i].name;
            if (cloned.indexOf(r) === -1) {
                console.log(`${r} (not cloned)`);
            } else {
                console.log(r);
            }
        }
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
                lsRemote({auth: value});
            }).catch((error: errors.BaseError) => {
                utils.exitWithError(error);
            });
        } else {
            utils.exitWithError(error);
        }
    });
}
