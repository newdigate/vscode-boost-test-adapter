# Boost.Test Adapter with debugging
* Extends original [boost test adapter](https://github.com/firoorg/vscode-boost-test-adapter) by firoorg, enabling debugging

## Features
* Boost tests will appear in [Test Explorer](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer)
* ```run``` or ```debug``` boost tests 
  * from ```Test Explorer``` 
  * from inside test source code
* Updated 2.0.20 (29 Jan 2022)
  * cancel running test
* Updated 2.0.19 (29 June 2021)
  * update configuration reloading
  * added ```boost-test-adapter.cwd``` config to specify current working directory to run test executable from
  * allow ```${parameters}``` in config settings
  
![debugger](https://github.com/newdigate/vscode-boost-test-adapter/raw/master/debug.gif)

## Required Configurations
point `boost-test-adapter.testExecutable` to  to the path of your boost test executable.

## Features that not implemented yet
- When debugging a test, the red/green status of the test is not updated in the test explorer
