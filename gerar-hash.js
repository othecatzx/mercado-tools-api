const bcrypt = require("bcrypt");

const senha = "AccountTheCatzXAdmin34352006!";

bcrypt.hash(senha, 12).then(hash => {
    console.log(hash);
});