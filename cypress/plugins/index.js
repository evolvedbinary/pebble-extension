/// <reference types="cypress" />
// ***********************************************************
// This example plugins/index.js can be used to load plugins
//
// You can change the location of this file or turn off loading
// the plugins file with the 'pluginsFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/plugins-guide
// ***********************************************************

// This function is called when a project is opened or re-opened (e.g. due to
// the project's config changing)

/**
 * @type {Cypress.PluginConfig}
 */
module.exports = (on, config) => {
  // `on` is used to hook into various events Cypress emits
  // `config` is the resolved Cypress config
  config.process = {
    chrome: process.chrome,
    defaultApp: process.defaultApp,
    electron: process.electron,
    isMainFrame: process.isMainFrame,
    mas: process.mas,
    noAsar: process.noAsar,
    noDeprecation: process.noDeprecation,
    resourcesPath: process.resourcesPath,
    sandboxed: process.sandboxed,
    throwDeprecation: process.throwDeprecation,
    traceDeprecation: process.traceDeprecation,
    traceProcessWarnings: process.traceProcessWarnings,
    type: process.type,
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    argv: process.argv,
    argv0: process.argv0,
    execArgv: process.execArgv,
    execPath: process.execPath,
    debugPort: process.debugPort,
    env: process.env,
    exitCode: process.exitCode,
    version: process.version,
    versions: process.versions,
    config: process.config,
    pid: process.pid,
    ppid: process.ppid,
    title: process.title,
    arch: process.arch,
    platform: process.platform,
    memoryUsage: process.memoryUsage,
    release: process.release,
    features: process.features,
    hrtime: process.hrtime,
    connected: process.connected,
    report: process.report,
    traceDeprecation: process.traceDeprecation,
  };
  config.env.homedir = require('os').homedir();
  return config;
}
