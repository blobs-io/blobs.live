class registerEvent {};
/**
 * Runs the register Event
 * 
 * @param {Array} args Method arguments
 * @returns {Promise<object>} An object with a username and a password property (password is hashed)
 */
registerEvent.run = (...args) => {
    const [res, io, data, displayError, captchas, bcrypt, sqlite] = args;
    return new Promise(resolve => {
        // If username/password is undefined
        if (!res.username || !res.password) return io.to(data.id).emit("register", {
            status: 400,
            message: "Either username or password is undefined."
        });

        // Username/Password length check
        if (res.username.length < 3 || res.username.length > 10) return io.to(data.id).emit("register", {
            status: 400,
            message: "Username needs to be at least 3 characters long and must not be longer than 10 characters."
        });

        if (res.password.length < 5 || res.password.length > 32) return io.to(data.id).emit("register", {
            status: 400,
            message: "Password needs to be at least 5 characters long and must not be longer than 32 characters."
        });

        if (/[^\w ]+/.test(res.username)) return displayError("Username should only contain A-Za-z_ ", data, "register", 400, io);

        if (!captchas.find(val => val.captcha === res.captcha)) return displayError("Captcha is not correct", data, "register", 400, io);

        const hash = bcrypt.hashSync(res.password, 10);

        sqlite.prepare("SELECT * FROM accounts WHERE username = ?").then(prepare => {
            prepare.get([res.username]).then(result => {
                if (result) return displayError("Username is already taken.", data, "register", 400, io);
                sqlite.prepare("INSERT INTO accounts VALUES (?, ?, 0)").then(prepare2 => {
                    prepare2.run([res.username, hash]).then(() => {
                        io.to(data.id).emit("register", {
                            status: 200,
                            message: "Account successfully created!"
                        });
                        captchas.splice(captchas.findIndex(val => val.captcha === res.captcha), captchas.findIndex(val => val.captcha === res.captcha));
                        resolve({
                            username: res.username,
                            password: hash
                        });
                    }).catch(console.log);
                }).catch(console.log);
            });
        }).catch(err => {
            if (err.toString().includes("no such table: accounts")) {
                displayError("A problem occured on the server-side.", data, "register", 500, io);
                sqlite.run("CREATE TABLE accounts (`username` TEXT, `password` TEXT, `br` INTEGER)").catch(console.log);
            }
        });






    });
};

module.exports = registerEvent;
