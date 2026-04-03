const ee = require('@google/earthengine');

function initEE() {
  return new Promise((resolve, reject) => {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const client_email = credentials.client_email;
    const private_key = (credentials.private_key || "").replace(/\\n/g, '\n').trim();

    ee.data.authenticateViaPrivateKey({ client_email, private_key }, () => {
      ee.initialize(null, null, () => {
        console.log('Earth Engine initialized');
        resolve();
      }, (err) => {
        console.error('Error initializing EE:', err);
        reject(err);
      });
    }, (err) => {
      console.error('Error authenticating EE:', err);
      reject(err);
    });
  });
}

module.exports = { ee, initEE };
