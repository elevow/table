const http = require('http');

const postData = JSON.stringify({
  name: "Test Room",
  maxPlayers: 6,
  gameType: "texas-holdem",
  blindLevels: { small: 5, big: 10 },
  createdBy: "11111111-1111-1111-1111-111111111111"
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/games/rooms/create',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('Making request to:', `http://${options.hostname}:${options.port}${options.path}`);

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers:`, JSON.stringify(res.headers, null, 2));

  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Response body:', data);
  });
});

req.on('error', (error) => {
  console.error('Request error:', error.message);
});

req.write(postData);
req.end();
