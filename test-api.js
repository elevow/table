const https = require('http');

const postData = JSON.stringify({
  name: "Test Room",
  maxPlayers: 6,
  gameType: "texas-holdem",
  blindLevels: { small: 5, big: 10 },
  createdBy: "11111111-1111-1111-1111-111111111111"
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/games/rooms/create',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = https.request(options, (res) => {
  console.log(`statusCode: ${res.statusCode}`);
  console.log(`headers:`, res.headers);

  res.on('data', (d) => {
    process.stdout.write(d);
  });
});

req.on('error', (error) => {
  console.error(error);
});

req.write(postData);
req.end();
