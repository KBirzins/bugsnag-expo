import Bugsnag from "../../..";
Bugsnag.start('api_key');
Bugsnag.use({
  name: 'foobar',
  init: client => 10
})
console.log(Bugsnag.getPlugin('foo') === 10)
