const readline = require('readline');
const vm = require('vm');
const { Client } = require('pg');

const rl = readline.createInterface({
    input : process.stdin,
    output: process.stdout
});
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres',
    password: '1234',
    port: 5432,
});

const App = {
    state : 0n,
    client : client,
    ready : false,
    sandbox : {
        uuidv4 : uuidv4,
        require : require,
        console : console,
        JSON : JSON
    },
    shell : true
};

function validString(str) {
    /*
        console.log( validString("'a'") );
        console.log( validString("a'") );
        console.log( validString("'a") );
        console.log( validString("a") );
        console.log( validString("a''''''") );
     */
    var close = false;
    if(str.charAt(0) != '\'') close = true;
    else {
        if(str.charAt(str.length-1) == '\'') str = str.substring(1,str.length-1);
        else str = str.substring(1,str.length);
    }
    str = str.split("'").join("\\'");
    return '\'' + str + '\'';
}
function validTable(str) {
    if(str == "test") return str;
    throw new Error("not a valid table");
}


function MainLoop() {

    var sb = [];
    var exit = false;
    if((App.state & 1n) > 0n) { // 1 - EXIT
        sb.unshift("EXIT");
        exit = true;
    }

    if((App.state & 2n) > 0n) { // 2 - DISCONNECT
        sb.unshift("DISCONNECT");
        client.end(err => {
            console.log('client has disconnected')
            if (err) {
                console.log('error during disconnection', err.stack)
            }
            App.ready = false;
        });
    }

    if(sb.length>0)
        console.log(sb.join("\r\n"));

    App.state = 0n;
    if(!exit) {
        setTimeout(MainLoop,100);
    }
}
MainLoop();

App.quit = function() {

    App.state = 1n;
    if(App.ready) {
        App.state |= 2n;
    }
    App.shell = false;
    setTimeout(()=>{
        process.exit();
    },2000);

}
App.sandbox.quit = ()=> {
    App.quit();
}

function add(data,callback) {
    if(!App.ready) {
        client.connect();
        App.ready = true;
    }
    var orig = data;
    try {
        var type = Object.prototype.toString.apply(data);
        if(type == "[object Function]") {
            var c = { proto : {} };
            c.ctor = data.toString();
            for(var key in data.prototype) {
                c.proto[key] = data.prototype[key].toString();
            }
            c.typeTag = "d377563c-60db-4b6e-83ef-3b899d081ce9";
            data = JSON.stringify(c);
        } else {
            data = JSON.stringify(orig);
        }
    } catch(e) {
        data = ""+orig;
    }
    data = validString(data);
    var table = validTable("test");
    client.query(`SELECT MAX(id) FROM ${table}`, (err, res) => {
        if(!err) {
            id = parseInt( res.rows[0].max ) + 1;
            client.query(`INSERT INTO ${table} (id,data) VALUES (${id},${data})`, (err, res) => {
                if(!err) {
                    console.log(res.rowCount==1?"INSERTED " + data:"FAIL");
                    if(callback) {
                        callback();
                    }
                } else {
                    console.log(err);   
                    App.state = 3n;
                }
            });
        } else {
            console.log(err);
            App.state = 3n;
        }
    });
}
App.sandbox.add = (str)=>{
    add(str);
}

function addfn(name,ctor) {
    if(!App.ready) {
        client.connect();
        App.ready = true;
    }
    try {
        var type = Object.prototype.toString.apply(ctor);
        if(type == "[object Function]") {
            var c = { proto : {} };
            c.name = name;
            c.ctor = ctor.toString();
            for(var key in ctor.prototype) {
                c.proto[key] = ctor.prototype[key].toString();
            }
            c.typeTag = "7dfc168d-6542-4f99-8e25-a1f91fd0d1bc";
            data = JSON.stringify(c);
        } else {
            throw "not function";
        }
    } catch(e) {
        console.log(e);
        throw e;
    }

    data = validString(data);
    var table = validTable("test");
    client.query(`SELECT MAX(id) FROM ${table}`, (err, res) => {
        if(!err) {
            id = parseInt( res.rows[0].max ) + 1;
            client.query(`INSERT INTO ${table} (id,data) VALUES (${id},${data})`, (err, res) => {
                if(!err) {
                    console.log(res.rowCount==1?"INSERTED " + data:"FAIL");
                } else {
                    console.log(err);   
                    App.state = 3n;
                }
            });
        } else {
            console.log(err);
            App.state = 3n;
        }
    });
}


App.sandbox.addfn = (name,ctor) => {
    addfn(name,ctor);
}

function find(data,callback) {
    if(!App.ready) {
        client.connect();
        App.ready = true;
    }
    //data = validString(data);
    var parts = data.split(" ");
    var table = validTable("test");
    client.query(`SELECT * FROM ${table}`, (err, res) => {
        if(!err) {
            var ret = [];
            for(var x = 0; x < res.rows.length;x++) {
                for(var y = 0; y < parts.length;y++) {
                    if( res.rows[x].data.indexOf(parts[y])!=-1 ) {
                        ret.push(res.rows[x]);
                        break;
                    }
                }
            }

            if(callback) {
                callback( ret );
            } else {
                console.log(ret);
            }
        } else {
            console.log(err);
        }
    });
}

App.sandbox.find = (str,callback)=> {
    // <10 >100
    // 2 3 4
    find(""+str,callback);
}


function fn(mkey,callback) {
    find(mkey,(rows) => { 
        if(rows.length>0) {
            try {
                var json = JSON.parse(rows[0].data);  
                if("typeTag" in json && json.typeTag == "d377563c-60db-4b6e-83ef-3b899d081ce9") {
                    var a = null;
                    eval("a = " + json.ctor);
                    for(var key in json.proto) {
                        eval("a.prototype." + key + "=" + json.proto[key]);
                    }
                    if(!callback) {
                        App.sandbox[mkey] = a;
                        console.log(mkey + " loaded.");
                        console.log(rows[0].data);
                    } else {
                        callback(a);
                    }
                } else if("typeTag" in json && json.typeTag == "7dfc168d-6542-4f99-8e25-a1f91fd0d1bc") {
                    var a = null;
                    eval("a = " + json.ctor);
                    for(var key in json.proto) {
                        eval("a.prototype." + key + "=" + json.proto[key]);
                    }
                    if(!callback) {
                        var nparts = json.name.split(".");
                        var p = App.sandbox;
                        for(var x = 0; x < nparts.length-1;x++) {
                            if(nparts[x] in p) {
                                p = p[ nparts[x] ];
                            } else {
                                p[nparts[x]] = {};
                                p = p[ nparts[x] ];
                            }
                        }
                        p[ nparts[ nparts.length-1 ] ] = a;
                        console.log(json.name + " loaded.");
                        console.log(rows[0].data);

                    } else {
                        callback(a);
                    }
                }
            } catch(e) {

            }
        }
    } )
}

App.sandbox.fn = (str,callback)=> {
    // <10 >100
    // 2 3 4
    fn(""+str,callback);
}


function remove(id,callback) {
    if(!App.ready) {
        client.connect();
        App.ready = true;
    }
    //data = validString(data);
    var table = validTable("test");
    var type = Object.prototype.toString.apply(id);
    if( type == "[object Array]") {
        for(var x = 0; x < id.length;x++) {
            id[x] = parseInt(id[x]);
        }
        id = "id IN (" + id.join(",") + ")";
    } else if(type == "[object Number]") {
        id = "id = " + parseInt(id);
    } else if(type == "[object Object]") {
        if("type" in id && id.type == "range1") {
            id = " id >= " + parseInt(id.value[0]) + " AND id <= " + parseInt(id.value[1]);
        }
    } else {
        console.log("id must be number or array");
        return;
    }
    var sql = `DELETE FROM ${table} WHERE ${id}`;
    console.log(sql);
    client.query(sql, (err, res) => {
        if(!err) {
            console.log(res.rowCount + " ROWS DELETED");
            if(callback) {
                callback();
            }
        } else {
            console.log(err);
        }
    });

}

App.sandbox.remove = function(id,callback) {
    remove(id,callback);
}

async function defrag(callback) {
    if(!App.ready) {
        client.connect();
        App.ready = true;
    }
    /*
        c = find count() table.
        for(var x = 0; x < c;x++) {
            find if id x is used.
                it is. [ok]
            it is not find min(id) where id > x
                update res to x
        }
    */
    var algo = {
        count : 0,
        cur : 0
    };
    var table = validTable("test");
    var map = [];
    console.log(sql);
    try {
        await client.query("BEGIN");
        var sql = `SELECT COUNT(id) FROM ${table}`;
        console.log(sql);
        var res1 = await client.query(sql);
        if(res1.rowCount == 1) {
            algo.count = res1.rows[0].count;
            algo.cur = 0;
            while(algo.cur < algo.count) {
                sql = `SELECT id FROM ${table} WHERE id  = ${algo.cur}`;
                console.log(sql);
                var res2 = await client.query(sql);
                if(res2.rowCount ==0) {
                    sql = `SELECT MIN(id) FROM ${table} WHERE id > ${algo.cur}`;
                    console.log(sql);
                    var res3 = await client.query(sql);
                    if( res3.rowCount == 0) {
                        throw new Error("ERR COUNT, NO NEXT");
                    } else if(res3.rowCount == 1) {
                        map.push([res3.rows[0].min,algo.cur]);
                        sql = `UPDATE ${table} SET id = ${algo.cur} WHERE id = ${res3.rows[0].min}`;
                        console.log(sql);
                        var res4 = await client.query(sql);
                        if(res4.rowCount == 1) {
                            algo.cur++;
                            continue;
                        } else {
                            throw new Error("ERR CANT UPDATE ID");
                        }
                    } else {
                        throw new Error("ERR TOO MANY MINS");
                    }
                } else {
                    map.push([algo.cur,algo.cur]);
                    algo.cur++;
                }
            }
            await client.query("COMMIT");
            callback && callback (map);
        } else {
            throw new Error("unknown size of table");
        }
    } catch(e) {
        await client.query("ROLLBACK");
    }
    return null;
}

App.sandbox.defrag = function(callback) {
    defrag(callback);
}

function shell() {
    if(!App.shell) return;
    rl.question('>', (answer) => {
        try {
            const script = new vm.Script(answer);
            const context = vm.createContext(App.sandbox);
            script.runInContext(context);
        } catch(e) {
            console.log(e);
        }
        if(App.shell) setTimeout(()=> { shell(); },0);
        else App.quit();
    });
}
shell();

