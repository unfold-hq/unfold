const path = require('node:path');
const Mocha = require('mocha');

exports.run = function run() {
  const mocha = new Mocha({ ui: 'bdd', timeout: 60_000, color: true, reporter: 'spec' });
  mocha.addFile(path.join(__dirname, 'extension.test.cjs'));
  return new Promise((resolve, reject) => {
    const runner = mocha.run(failures => failures ? reject(new Error(`${failures} integration tests failed`)) : resolve());
    runner.on('fail', (test, error) => console.error(`FAILED: ${test.fullTitle()}\n${error && error.stack || error}`));
  });
};
