/*
 Copyright 2013 Daniel Wirtz <dcode@dcode.io>

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

/**
 * ClosureCompiler.js: Configure Script (c) 2013 Daniel Wirtz <dcode@dcode.io>
 * Released under the Apache License, Version 2.0
 * see: https://github.com/dcodeIO/ClosureCompiler.js for details
 */

var ClosureCompiler = require(__dirname+"/../ClosureCompiler.js"),
    fs = require("fs"),
    path = require("path"),
	child_process = require("child_process"),
    pkg = require(__dirname+"/../package.json"),
    zlib = require("zlib"),
    tar = require("tar");

console.log("Configuring ClosureCompiler.js "+pkg.version+" ...\n");

// Closure Compiler download url
var ccUrl = "http://closure-compiler.googlecode.com/files/compiler-latest.tar.gz";

// Temporary file for the download
var ccTempFile = path.normalize(__dirname+path.sep+".."+path.sep+"compiler"+path.sep+"compiler.tar.gz");

// Bundled JRE download url
var jreUrl = "http://bundled-openjdk-jre.googlecode.com/files/OpenJDK-JRE-7u6_24.tar.gz";

// Temporary file for the download
var jreTempFile = path.normalize(__dirname+path.sep+".."+path.sep+"jre"+path.sep+"jre.tar.gz");

console.log("  Downloading "+ccUrl+" ...");
var lastBytes = 0, currentBytes = 0, mb = 1024*1024;
download(ccUrl, ccTempFile, function(error, bytes) {
    if (error) {
        console.log("  ✖ Download failed: "+error+"\n");
        fail();
    }
    console.log("  ✔ Download complete: "+ccTempFile+" ("+parseInt(bytes/mb, 10)+" mb)\n");
    require("sleep").sleep(1);
    console.log("  Unpacking "+ccTempFile+" ...");
    unpack(ccTempFile, function(error) {
        if (error) {
            console.log("  ✖ Unpack failed: "+error+"\n");
            fail();
        }
        require("sleep").sleep(1); // Let the entry callbacks finish
        console.log("  ✔ Unpack complete.\n");
        configure_jre();
    }, function(entry) {
        console.log("  | "+entry["path"]);
    });
}, function(bytes, total) {
    currentBytes += bytes;
    if (currentBytes == bytes || currentBytes - lastBytes >= mb) {
        console.log("  | "+parseInt(currentBytes/mb, 10)+" / "+(total > 0 ? parseInt(total/mb, 10) : "???")+" mb");
        lastBytes = currentBytes;
    }
});

/**
 * Configures the JRE.
 */
function configure_jre() {
    console.log("  Configuring JRE ...");
    
    // Test if there is already a global Java so we don't need to download anything
    ClosureCompiler.testJava(ClosureCompiler.getGlobalJava(), function(ok) {
        if (ok) {
            console.log("  ✔ Global Java is available, perfect!\n");
            // Travis CI for example has one, so we save their bandwidth. And Google's. And yours. And...
            finish();
        } else {
            if (fs.existsSync(__dirname+path.sep+".."+path.sep+"jre"+path.sep+"bin")) {
                console.log("  ✖ Global Java not found, so let's test our bundled one ...\n");
                runTest();
            } else {
                console.log("  ✖ Global Java not found, we need to download the bundled JRE ...");
                console.log("    Downloading "+jreUrl+" ...");
                lastBytes = 0; currentBytes = 0;
                download(jreUrl, jreTempFile, function(error, bytes) {
                    if (error) {
                        console.log("    ✖ Download failed: "+error+"\n");
                        fail();
                    }
                    console.log("    ✔ Download complete: "+jreTempFile+" ("+parseInt(bytes/mb, 10)+" mb)\n");
                    require("sleep").sleep(1);
                    console.log("      Unpacking "+jreTempFile+" ...");
                    unpack(jreTempFile, function(error) {
                        if (error) {
                            console.log("      ✖ Unpack failed: "+error+"\n");
                            fail();
                        }
                        require("sleep").sleep(1); // Let the entry callbacks finish
                        console.log("      ✔ Unpack complete.\n");
                        configure();
                        runTest();
                    }, function(entry) {
                        console.log("      | "+entry["path"]);
                    });
                }, function(bytes, total) {
                    currentBytes += bytes;
                    if (currentBytes == bytes || currentBytes - lastBytes >= mb) {
                        console.log("    | "+parseInt(currentBytes/mb, 10)+" / "+(total > 0 ? parseInt(total/mb, 10) : "???")+" mb");
                        lastBytes = currentBytes;
                    }
                });
            }
        }
    });
}

/**
 * Downloads a file.
 * @param {string} downloadUrl
 * @param {string} filename
 * @param {function(?Error,number)} callback
 * @param {function(number)=} ondata
 */
function download(downloadUrl, filename, callback, ondata) {
    var url = require("url").parse(downloadUrl);
    var out = require("fs").createWriteStream(filename, { flags: 'w', encoding: null, mode: 0666 });
    var bytes = 0, total = -1;
    var req = require("http").request({
        "hostname": url["host"],
        "method": "GET",
        "path": url["path"],
        "agent": false
    }, function(res) {
        if (res.headers["content-length"]) {
            total = parseInt(res.headers["content-length"], 10);
        }
        if (res.statusCode != 200) {
            res.setEncoding(null);
            callback(new Error("Download failed: HTTP status code "+res.statusCode), -1);
            return;
        }
        res.on("data", function(chunk) {
            bytes += chunk.length;
            if (ondata) ondata(chunk.length, total);
            out.write(chunk);
        });

        res.on("end", function() {
            callback(null, bytes);
        });
    });
    req.on("error", function(e) {
        callback(e, -1);
    });
    req.end();
}

/**
 * Unpacks a file in place.
 * @param {string} filename File name
 * @param {function(?Error)} callback
 * @param {function(Object)=} entryCallback
 */
function unpack(filename, callback, entryCallback) {   
    var input = fs.createReadStream(filename, { flags: 'r', encoding: null }),
        files = {},
        dir = path.dirname(filename),
        returned = false;
    
    input.pipe(zlib.createGunzip()).pipe(tar.Parse()).on("entry", function(entry) {
        if (entryCallback) entryCallback(entry);
        if (entry["type"] == 'File') {
            files[entry["path"]] = fs.createWriteStream(dir+path.sep+entry["path"], { flags: 'w', encoding: null });
            entry.pipe(files[entry["path"]]);
            entry.on("end", function() {
                files[entry["path"]].end();
                files[entry["path"]]["done"] = true;
                var alldone = true;
                var names = Object.keys(files);
                for (var i=0; i<names.length; i++) {
                    if (!files[names[i]]["done"]) {
                        alldone = false;
                        break;
                    }
                }
                if (alldone && !returned) {
                    returned = true;
                    callback(null);
                }
            });
        } else if (entry["type"] == "Directory") {
            try {
                fs.mkdirSync(dir+path.sep+entry["path"]);
            } catch (e) {
                if (!fs.existsSync(dir+path.sep+entry["path"])) {
                    if (!returned) {
                        returned = true;
                        callback(e);
                    }
                }
            }
        }
    }).on("error", function(e) {
        if (!returned) {
            returned = true;
            callback(e);
        }
    });
}

/**
 * Configures our bundled Java.
 */
function configure() {
    // Basically: Rename the platform's bin_* directory to bin and set necessary file permissions
    var to = path.normalize(__dirname+path.sep+".."+path.sep+"jre"+path.sep+"bin");
    var java = to+path.sep+"java"+ClosureCompiler.JAVA_EXT;
    console.log("  Configuring bundled JRE for platform '"+process.platform+"' ...");
    if (fs.existsSync(__dirname+"/../jre/bin")) {
        console.log("  ✔ Bundled JRE is already configured.\n");
    } else {
        var jre = path.normalize(__dirname+path.sep+".."+path.sep+"jre");
        console.log("  | 0755 "+jre);
        fs.chmodSync(jre, 0755);
        var dirname;
        if ((/^win/i).test(process.platform)) {
            dirname = "bin_windows";
        } else if ((/^darwin/i).test(process.platform)) {
            dirname = "bin_mac";
        } else {
            dirname = "bin_linux";
        }
        var from = path.normalize(__dirname+path.sep+".."+path.sep+"jre"+path.sep+dirname);
        fs.chmodSync(from, 0755);
        console.log("  | "+from+" -> "+to+"");
        fs.renameSync(from, to);
        console.log("  | 0755 "+java);
        fs.chmodSync(java, 0755);
        console.log("  Complete.\n");
    }

}

/**
 * Runs the final test.
 */
function runTest() {
    console.log("  Testing bundled Java ...");
    console.log("  | exec "+ClosureCompiler.getBundledJava());
    ClosureCompiler.testJava(ClosureCompiler.getBundledJava(), function(ok) {
        if (ok) {
            console.log("  ✔ Successfully called bundled Java!\n");
            finish();
        } else {
            console.log("  ✖ Failed to call bundled java, trying global java instead ...");
            console.log("    | exec "+ClosureCompiler.getGlobalJava()+"\n");
            ClosureCompiler.testJava(ClosureCompiler.getGlobalJava(), function(ok) {
                if (ok) {
                    console.log("    ✔ Successfully called global Java!\n");
                    finish();
                } else {
                    console.log("    ✖ Failed to call global Java.\n");
                    fail();
                }
            });
        }
    });
}

/**
 * Cleans up.
 */
function cleanUp() {
    try { fs.unlinkSync(ccTempFile); } catch (e) {}
    try { fs.unlinkSync(jreTempFile); } catch (e) {}
    // ...your harddrive's space.
}

/**
 * Fails.
 */
function fail() {
    cleanUp();
    console.log("  ✖ Unfortunately, ClosureCompiler.js could not be configured.");
    console.log("    See: https://github.com/dcodeIO/ClosureCompiler.js (create an issue maybe)\n");
    process.exit(1);
}

/**
 * Finishes.
 */
function finish() {
    cleanUp();
    console.log("  ✔ ClosureCompiler.js has successfully been configured. Have fun!\n");
}
