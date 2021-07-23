# Fusion Studio Theia Extension
[![CircleCI](https://circleci.com/gh/evolvedbinary/fusion-studio-extension/tree/master.svg?style=svg)](https://circleci.com/gh/evolvedbinary/fusion-studio-extension/tree/master)
[![Cypress Dashboard](https://img.shields.io/badge/cypress-dashboard-brightgreen.svg)](https://dashboard.cypress.io/#/projects/ftw148/runs)
[![npm version](https://badge.fury.io/js/fusion-studio-extension.svg)](https://badge.fury.io/js/fusion-studio-extension)
[![License](https://img.shields.io/badge/license-GPL%203-blue.svg)](https://opensource.org/licenses/GPL-3.0)

**Fusion DB**'s extension for [Theia IDE](https://theia-ide.org).
If you don't know what Theia is, then you likely want the full [Fusion Studio IDE application](https://github.com/evolvedbinary/fusion-studio).



## Getting started:
### Requirements:
*   [Fusion Studio API](https://github.com/evolvedbinary/fusion-studio-api) installed in a compatible [FusionDB Server](https://www.fusiondb.com) or [eXist-db](https://www.exist-db.org) database.

#### For building
*   [Node 12](https://nodejs.org/dist/v12.18.3/). `>= 12.18.3` (it should most likely be installed with [nvm](https://github.com/nvm-sh/nvm))
    * Node 10 may work, and Node 14 should work... however we are focused on Node 12 compatibility.
*   [Yarn](https://yarnpkg.com). `> 1.15.x` (it can easily be installed globally via npm (Node Package Manager), but you should be aware this has a small [security implication](https://classic.yarnpkg.com/en/docs/install/#install-via-npm). npm is installed when you install Node).
*   [Python](https://www.python.org/) `>= 3.7.7.` (if your system does not provide it, consider using [pyenv](https://github.com/pyenv/pyenv)).
        If you are having trouble building and have multiple versions of Python installed via `pyenv` or any other mechanism, see the [Debugging Python Build Issues](#debugging-python-build-issues) section).
*   Windows platforms only:
    *   Microsoft Visual Studio 2015 C++. Tested with Community Edition
*   macOS playforms only:
    *   XCode Command Line tools. You can check that these are installed and compatible with node-gyp by following these [instructions](https://github.com/nodejs/node-gyp/blob/master/macOS_Catalina.md).

#### Debugging Python Build Issues
If you are experiencing build issues and have multiple versions of Python installed via pyenv or some other such mechanism
then the following information may be useful.

*   Due to upstream constraints from [theia](https://theia-ide.org) we can override the inherited dependency on Python 2. For systems that ship with python2 pre-installed, fusion-studio-extension should continue to build normally.
    *   Build errors with node-gyp are unfortunately common on systems with multiple python installations. On systems that no longer include python2, or on macOS >10.14 we recommend using python 3.8, and configuring the build environment. The following assumes you used `nvm` and `pyenv` to install your desired versions.
    1.  Make sure your system and shell use the correct python environment:
        -   ```bash
            python --version
            ```
            It should indicate `Python 3.8.x` or better.
        -   Set an environment variable to force node-gyp to use this version, e.g. `3.8.3`
            ```bash
            echo 'export NODE_GYP_FORCE_PYTHON="~/.pyenv/versions/3.8.3/bin/python3"' >> ~/.zshrc
            ```
            For bash users replace `.zshrc` with `bashrc`

#### Example of setting up a Ubuntu 20.04 build environment
The following commands will install the required packages and setup Python 3 via pyenv on Ubuntu 20.04.

```
sudo curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
sudo apt-get install nodejs yarnpkg libx11-dev libxkbfile-dev
alias yarn=yarnpkg

git clone https://github.com/pyenv/pyenv.git ~/.pyenv
echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.bashrc
echo 'export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.bashrc
echo -e 'if command -v pyenv 1>/dev/null 2>&1; then\n  eval "$(pyenv init -)"\nfi' >> ~/.bashrc

sudo apt-get install --no-install-recommends make build-essential libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev wget curl llvm libncurses5-dev xz-utils tk-dev libxml2-dev libxmlsec1-dev libffi-dev liblzma-dev
pyenv install 3.8.4
pyenv global 3.8.4
exec $SHELL

```

#### Example of setting up a CentOS 7 build environment
The following commands will install the required packages on CentOS 7.

```
sudo yum update
sudo yum install -y libX11-devel libxkbfile-devel
sudo yum install -y gcc-c++ make
sudo curl -sL https://rpm.nodesource.com/setup_12.x | sudo bash -
sudo yum install -y nodejs
curl -sL https://dl.yarnpkg.com/rpm/yarn.repo | sudo tee /etc/yum.repos.d/yarn.repo
sudo yum install -y yarn
sudo yum install -y rpm-build
```

#### For Testing
*   [cypress.js](https://www.cypress.io) ` >= 8.0.0`.



### Install and build:
Clone the repo, and build the source:
```bash
$ git clone https://github.com/evolvedbinary/fusion-studio-extension.git
$ cd fusion-studio-extension
$ yarn
```

> You may get the error `No package 'x11' found` on Ubuntu (Minimal installation), you'll need to install these packages:
> ```bash
> sudo apt install libx11-dev libxkbfile-dev
> ```

### Test the extension
#### Test on the browser
*   run this after install, and run it right after switching from Electron to the browser:
```bash
$ yarn run rebuild:browser
```
*   Start the IDE:
```bash
$ cd browser-app
$ yarn start
```
#### Test Electron app
*   run this after install, and run it right after switching from the browser to Electron:
```bash
$ yarn run rebuild:electron
```
*   Start the IDE:
```bash
$ cd electron-app
$ yarn start
```

#### Integration Testing
To run the integrations tests you need a running database with the fusion-studio-api installed. It should be reachable at `localhost:8080` and have an empty admin password. You can then run the integration test GUI locally by using:
```bash
yarn run cypress open
```
or in cases where the above fails to load the [cypress test runner](https://docs.cypress.io/guides/core-concepts/test-runner.html#Overview), use:
```bash
npx cypress open
```

Integration tests are also run on travis. To see a similar command line style output use:
```bash
yarn run cypress run
```
### Developing
*   To compile css:
```bash
$ yarn run sass:watch
```
To watch for files changes:
*   To compile the extension
```bash
$ cd fusion-studio-extension
$ yarn watch
```
*   To compile the browser app
```bash
$ cd browser-app
$ yarn watch
```
*   To compile Electron app
```bash
$ cd electron-app
$ yarn watch
```

**Extra**
-   You can debug both the browser and Electron apps using VS Code launch configurations:
    -   `"Start Browser Backend"`
    -   `"Start Electron Backend"`
-   You can compile css file at anytime by running:
```bash
$ yarn run sass
```

-   You can run Fusion Studio in a docker container.
    -   First, you need to build the docker image:
    ```bash
    $ cd browser-app
    $ docker build --rm --force-rm -t evolvedbinary/fusion-studio .
    ```
    -   Then, run the container and expose port 3000:
    ```bash
    $ docker run -ditp 3000:3000 --name fusion-studio evolvedbinary/fusion-studio
    ```