//! mestronomo-capture: captura o áudio de um único aplicativo do Windows (process loopback)
//! e escreve PCM cru no stdout: 48 kHz, estéreo, s16le — o formato que o Discord espera.
//!
//! Uso:
//!   mestronomo-capture list                 -> JSON com os apps que têm sessão de áudio
//!   mestronomo-capture capture <nome.exe>   -> captura o app (e os processos filhos dele)
//!   mestronomo-capture capture --pid <pid>

use std::collections::{BTreeMap, VecDeque};
use std::ffi::OsStr;
use std::io::Write;

use anyhow::{Context, Result, anyhow, bail};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};
use wasapi::*;

const SAMPLE_RATE: usize = 48_000;
const CHANNELS: usize = 2;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("list") => list(),
        Some("capture") => match args.get(1).map(String::as_str) {
            Some("--pid") => args
                .get(2)
                .and_then(|p| p.parse().ok())
                .ok_or_else(|| anyhow!("--pid precisa de um número"))
                .and_then(capture),
            Some(name) => root_pid_by_name(name).and_then(capture),
            None => Err(anyhow!("informe o nome do executável, ex: Spotify.exe")),
        },
        _ => Err(anyhow!("uso: mestronomo-capture list | capture <nome.exe> | capture --pid <pid>")),
    };
    if let Err(err) = result {
        eprintln!("erro: {err:#}");
        std::process::exit(1);
    }
}

fn processes() -> System {
    System::new_with_specifics(RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()))
        .expect("falha ao ler a lista de processos")
}

/// Sobe na árvore enquanto o pai tiver o mesmo nome. O Spotify e os navegadores tocam áudio
/// num processo filho, então capturamos a árvore a partir do processo raiz do app.
fn root_of(system: &System, pid: Pid) -> Pid {
    let mut current = pid;
    while let Some(proc_) = system.process(current) {
        match proc_.parent().and_then(|p| system.process(p)) {
            Some(parent) if parent.name() == proc_.name() => current = parent.pid(),
            _ => break,
        }
    }
    current
}

fn root_pid_by_name(name: &str) -> Result<u32> {
    let system = processes();
    let pid = system
        .processes_by_exact_name(OsStr::new(name))
        .next()
        .map(|p| p.pid())
        .with_context(|| format!("nenhum processo chamado {name} está rodando"))?;
    Ok(root_of(&system, pid).as_u32())
}

/// Lista os apps que têm (ou tiveram) sessão de áudio em algum dispositivo de saída.
fn list() -> Result<()> {
    initialize_mta().ok()?;
    let system = processes();
    let enumerator = DeviceEnumerator::new()?;
    // nome do exe -> (pid raiz, está tocando agora)
    let mut apps: BTreeMap<String, (u32, bool)> = BTreeMap::new();

    for device in &enumerator.get_device_collection(&Direction::Render)? {
        let sessions = device?.get_iaudiosessionmanager()?.get_audiosessionenumerator()?;
        for i in 0..sessions.get_count()? {
            let control = sessions.get_session(i)?;
            let state = control.get_state()?;
            let pid = control.get_process_id()?;
            if pid == 0 || state == SessionState::Expired {
                continue;
            }
            let root = root_of(&system, Pid::from_u32(pid));
            let Some(proc_) = system.process(root) else { continue };
            let name = proc_.name().to_string_lossy().into_owned();
            let entry = apps.entry(name).or_insert((root.as_u32(), false));
            entry.1 |= state == SessionState::Active;
        }
    }

    let items: Vec<String> = apps
        .iter()
        .map(|(name, (pid, active))| {
            format!(r#"{{"name":"{}","pid":{pid},"active":{active}}}"#, json_escape(name))
        })
        .collect();
    println!("[{}]", items.join(","));
    Ok(())
}

fn json_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn capture(pid: u32) -> Result<()> {
    initialize_mta().ok()?;
    eprintln!("capturando pid {pid}");

    let format = WaveFormat::new(16, 16, &SampleType::Int, SAMPLE_RATE, CHANNELS, None);
    let mut client = AudioClient::new_application_loopback_client(pid, true)?;
    let mode = StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 };
    client.initialize_client(&format, &Direction::Capture, &mode)?;
    let event = client.set_get_eventhandle()?;
    let capture_client = client.get_audiocaptureclient()?;
    client.start_stream()?;

    let mut queue: VecDeque<u8> = VecDeque::new();
    let mut stdout = std::io::stdout().lock();
    let mut system = processes();

    loop {
        // Se o app estiver em silêncio o Windows não sinaliza o evento; o mixer do Mestrônomo
        // trata a falta de dados como silêncio, então só seguimos esperando.
        if event.wait_for_event(1000).is_err() {
            system.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
            if system.process(Pid::from_u32(pid)).is_none() {
                bail!("o processo {pid} foi encerrado");
            }
            continue;
        }
        while capture_client.get_next_packet_size()?.unwrap_or(0) > 0 {
            capture_client.read_from_device_to_deque(&mut queue)?;
        }
        let (a, b) = queue.as_slices();
        // Falha ao escrever = o Mestrônomo fechou o pipe; encerramos sem alarde.
        if stdout.write_all(a).and_then(|_| stdout.write_all(b)).and_then(|_| stdout.flush()).is_err() {
            break;
        }
        queue.clear();
    }
    client.stop_stream()?;
    Ok(())
}
