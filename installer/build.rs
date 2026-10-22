use std::env;
use std::fs::File;
use std::io::{self, Write};
use std::path::PathBuf;

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// Name of the program inside the payload and in the install folder.
const EXE: &str = "GladosXshell.exe";

fn main() {
    println!("cargo:rerun-if-env-changed=GXS_PAYLOAD");
    println!("cargo:rerun-if-env-changed=GXS_FLAVOR");
    println!("cargo::rustc-check-cfg=cfg(gxs_debug)");

    match env::var("GXS_FLAVOR").as_deref() {
        Ok("debug") => println!("cargo:rustc-cfg=gxs_debug"),
        Ok("release") | Err(_) => {}
        Ok(other) => panic!("GXS_FLAVOR must be debug or release, not {other}"),
    }

    // Without a payload (plain cargo check/test) the installer builds but says it is incomplete.
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("payload.zip");
    let mut zip = ZipWriter::new(File::create(&out).unwrap());
    if let Some(program) = env::var_os("GXS_PAYLOAD") {
        let program = PathBuf::from(program);
        println!("cargo:rerun-if-changed={}", program.display());
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .compression_level(Some(9))
            .large_file(false);
        zip.start_file(EXE, options).unwrap();
        let mut source = File::open(&program).unwrap_or_else(|e| panic!("{}: {e}", program.display()));
        io::copy(&mut source, &mut zip).unwrap();
    }
    zip.finish().unwrap().flush().unwrap();

    tauri_build::build()
}
