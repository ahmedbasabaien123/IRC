const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const cookieParser = require('cookie-parser');

app.use(cookieParser());

const channels = {};

app.get('/', (req, res) => {
    res.sendFile(`${__dirname}/public/login.html`);
});

app.get('/chat', (req, res) => {
    const username = req.query.username;
    console.log(username);

    res.cookie('username', username);

    if (!username) {
        return res.redirect('/');
    }
    res.sendFile(`${__dirname}/public/index.html`);
});

io.on('connection', (socket) => {
    console.log('Un utilisateur s\'est connecté');

    const username = decodeURIComponent(socket.handshake.headers.cookie.replace(/(?:(?:^|.*;\s*)username\s*\=\s*([^;]*).*$)|^.*$/, "$1"));

    socket.on('chat message', (msg) => {
        io.emit('chat message', msg);
    });

    socket.on('create channel', (channelName) => {
        channels[channelName] = [];
        io.emit('update channels', Object.keys(channels));
    });

    socket.on('delete channel', (channelNameToDelete) => {
        delete channels[channelNameToDelete];
        io.emit('update channels', Object.keys(channels));
    });

    socket.on('rename channel', ({ currentChannelName, newChannelName }) => {
        channels[newChannelName] = channels[currentChannelName];
        delete channels[currentChannelName];
        io.emit('update channels', Object.keys(channels));
    });

    socket.on('join channel', (channelName) => {
        socket.join(channelName);
        channels[channelName].push({ id: socket.id, username: username });
        io.to(channelName).emit('update users', getConnectedUsers(channelName));
        const message = `${username} has joined the channel ${channelName}`;
        io.to(channelName).emit('user joined', message);
    });

    socket.on('quit channel', (channelNameToQuit) => {
        if (channels[channelNameToQuit]) {
            const index = channels[channelNameToQuit].findIndex(user => user.id === socket.id);
            if (index !== -1) {
                const username = channels[channelNameToQuit][index].username;
                channels[channelNameToQuit].splice(index, 1);
                io.to(channelNameToQuit).emit('update users', getConnectedUsers(channelNameToQuit));
                const message = `${username} has quit the channel ${channelNameToQuit}`;
                io.to(channelNameToQuit).emit('user left', message);
                socket.leave(channelNameToQuit);
            }
        }
    });

    socket.on('disconnect', () => {
        Object.keys(channels).forEach((channel) => {
            const index = channels[channel].findIndex(user => user.id === socket.id);
            if (index !== -1) {
                const username = channels[channel][index].username;
                channels[channel].splice(index, 1);
                io.to(channel).emit('update users', getConnectedUsers(channel));
                const message = `${username} has left the channel ${channel}`;
                io.to(channel).emit('user left', message);
            }
        });
    });

    socket.on('list users', (channelName) => {
        const users = getConnectedUsers(channelName);
        socket.emit('update users', users);
    });
});

function getConnectedUsers(channelName) {
    const users = [];

    if (channels[channelName]) {
        channels[channelName].forEach((user) => {
            users.push(user.username);
        });
    }

    return users;
}

server.listen(3000, () => {
    console.log('Listening on port 3000');
});
