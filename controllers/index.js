var Router = require('regex-router');

var R = new Router(function(req, res) {
  res.status(404).die('No resource at: ' + req.url);
});

R.any(/^\/files/, require('./files'));

module.exports = R.route.bind(R);
