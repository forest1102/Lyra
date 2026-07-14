use lyra_core::Database;
use lyra_mcp::McpServer;
use std::io::{BufRead, Write};
use std::path::PathBuf;

fn main() {
    if let Err(error) = run() {
        eprintln!("lyra-mcp: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let database_path = std::env::var_os("LYRA_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(default_database_path);
    if let Some(parent) = database_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let server = McpServer::new(Database::open(database_path)?);
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        let request = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                let response = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": { "code": -32700, "message": error.to_string() }
                });
                serde_json::to_writer(&mut stdout, &response)?;
                stdout.write_all(b"\n")?;
                stdout.flush()?;
                continue;
            }
        };
        let response = server.handle(request);
        if !response.is_null() {
            serde_json::to_writer(&mut stdout, &response)?;
            stdout.write_all(b"\n")?;
            stdout.flush()?;
        }
    }
    Ok(())
}

fn default_database_path() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join("Library/Application Support/app.lyra.focus/lyra.db")
}
