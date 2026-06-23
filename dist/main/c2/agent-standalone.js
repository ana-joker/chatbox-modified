process.env.C2_SILENT = '1';
const agent = require('./agent');
agent.init();
setInterval(() => {}, 2147483647);
