use std::collections::HashSet;
use thiserror::Error;

const MAX_SOURCE_BYTES: usize = 48 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceValidation {
    pub synth_def_names: Vec<String>,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SourcePolicyError {
    #[error("source exceeds 48 KiB")]
    SourceTooLarge,
    #[error("forbidden selector: .{0}")]
    ForbiddenSelector(String),
    #[error("selector is not allowed: .{0}")]
    UnknownSelector(String),
    #[error("forbidden identifier: {0}")]
    ForbiddenIdentifier(String),
    #[error("forbidden symbol: \\{0}")]
    ForbiddenSymbol(String),
    #[error("class is not allowed: {0}")]
    UnknownClass(String),
    #[error("invalid track contract: {0}")]
    InvalidContract(String),
    #[error("invalid namespace: {0}")]
    InvalidNamespace(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenKind {
    Identifier,
    Symbol,
    Selector,
    String,
    Comment,
    Number,
    Punctuation,
}

#[derive(Debug, Clone)]
struct Token<'a> {
    kind: TokenKind,
    text: &'a str,
    start: usize,
    end: usize,
}

pub struct SourcePolicy {
    allowed_classes: HashSet<&'static str>,
    allowed_selectors: HashSet<&'static str>,
    forbidden_identifiers: HashSet<&'static str>,
    forbidden_selectors: HashSet<&'static str>,
}

impl SourcePolicy {
    pub fn v1() -> Self {
        Self {
            allowed_classes: [
                "SinOsc",
                "LFSaw",
                "LFTri",
                "Pulse",
                "VarSaw",
                "Formant",
                "Blip",
                "WhiteNoise",
                "PinkNoise",
                "BrownNoise",
                "ClipNoise",
                "Dust",
                "Dust2",
                "LFNoise0",
                "LFNoise1",
                "LFNoise2",
                "Env",
                "EnvGen",
                "Line",
                "XLine",
                "Lag",
                "Lag2",
                "Lag3",
                "Decay2",
                "LPF",
                "HPF",
                "BPF",
                "BRF",
                "RLPF",
                "RHPF",
                "Resonz",
                "Ringz",
                "OnePole",
                "LeakDC",
                "DelayN",
                "DelayL",
                "DelayC",
                "CombN",
                "CombL",
                "CombC",
                "AllpassN",
                "AllpassL",
                "AllpassC",
                "FreeVerb",
                "FreeVerb2",
                "Pan2",
                "Balance2",
                "Splay",
                "SynthDef",
                "Out",
                "Mix",
                "Scale",
                "Rest",
                "Done",
                "Pbind",
                "Ppar",
                "Pseq",
                "Prand",
                "Pxrand",
                "Pwrand",
                "Pwhite",
                "Pexprand",
                "Pbrown",
                "Pseries",
                "Pgeom",
                "Pn",
                "Pstutter",
                "Pdup",
                "Pkey",
            ]
            .into_iter()
            .collect(),
            allowed_selectors: [
                "ar",
                "kr",
                "ir",
                "asr",
                "perc",
                "freeSelf",
                "midicps",
                "midiratio",
                "dbamp",
                "clip",
                "range",
                "exprange",
                "linexp",
                "round",
            ]
            .into_iter()
            .collect(),
            forbidden_identifiers: [
                "Server", "Buffer", "File", "Pipe", "UnixCmd", "Routine", "Task", "Pfunc", "Plazy",
                "SoundIn", "In", "DiskIn", "BufRd", "GVerb", "NetAddr", "OSCFunc", "Quarks",
            ]
            .into_iter()
            .collect(),
            forbidden_selectors: [
                "add",
                "play",
                "fork",
                "unixCmd",
                "systemCmd",
                "write",
                "read",
                "load",
                "open",
                "connect",
                "sendMsg",
                "sendBundle",
                "do",
                "while",
                "loop",
            ]
            .into_iter()
            .collect(),
        }
    }

    pub fn validate(&self, source: &str) -> Result<SourceValidation, SourcePolicyError> {
        if source.len() > MAX_SOURCE_BYTES {
            return Err(SourcePolicyError::SourceTooLarge);
        }
        let tokens = tokenize(source);
        for token in tokens
            .iter()
            .filter(|token| !matches!(token.kind, TokenKind::Comment | TokenKind::String))
        {
            match token.kind {
                TokenKind::Selector => {
                    let selector = token.text.trim_start_matches('.');
                    if self.forbidden_selectors.contains(selector) {
                        return Err(SourcePolicyError::ForbiddenSelector(selector.into()));
                    }
                    if !self.allowed_selectors.contains(selector) {
                        return Err(SourcePolicyError::UnknownSelector(selector.into()));
                    }
                }
                TokenKind::Identifier => {
                    let identifier = token.text.trim_start_matches('~');
                    if self.forbidden_identifiers.contains(identifier) {
                        return Err(SourcePolicyError::ForbiddenIdentifier(identifier.into()));
                    }
                    if identifier.chars().next().is_some_and(char::is_uppercase)
                        && !self.allowed_classes.contains(identifier)
                    {
                        return Err(SourcePolicyError::UnknownClass(identifier.into()));
                    }
                }
                TokenKind::Symbol if matches!(token.text, "\\out" | "\\group") => {
                    return Err(SourcePolicyError::ForbiddenSymbol(
                        token.text.trim_start_matches('\\').into(),
                    ));
                }
                _ => {}
            }
        }

        require_identifier(&tokens, "~lyraTrack")?;
        require_identifier(&tokens, "synthDefs")?;
        require_identifier(&tokens, "pattern")?;

        let synth_def_indices: Vec<usize> = tokens
            .iter()
            .enumerate()
            .filter_map(|(index, token)| {
                (token.kind == TokenKind::Identifier && token.text == "SynthDef").then_some(index)
            })
            .collect();
        if !(1..=4).contains(&synth_def_indices.len()) {
            return Err(SourcePolicyError::InvalidContract(
                "track must contain 1 to 4 SynthDefs".into(),
            ));
        }

        let mut synth_def_names = Vec::with_capacity(synth_def_indices.len());
        for (position, token_index) in synth_def_indices.iter().copied().enumerate() {
            let end = synth_def_indices
                .get(position + 1)
                .copied()
                .unwrap_or(tokens.len());
            let slice = &tokens[token_index..end];
            let name = slice
                .iter()
                .find(|token| token.kind == TokenKind::Symbol)
                .map(|token| token.text.trim_start_matches('\\'))
                .ok_or_else(|| {
                    SourcePolicyError::InvalidContract("SynthDef is missing a symbol name".into())
                })?;
            if !matches!(
                name,
                "lyra_voice_1" | "lyra_voice_2" | "lyra_voice_3" | "lyra_voice_4"
            ) {
                return Err(SourcePolicyError::InvalidContract(format!(
                    "invalid SynthDef placeholder: {name}"
                )));
            }
            if synth_def_names.iter().any(|existing| existing == name) {
                return Err(SourcePolicyError::InvalidContract(format!(
                    "duplicate SynthDef: {name}"
                )));
            }
            let control_start = slice
                .iter()
                .position(|token| token.kind == TokenKind::Punctuation && token.text == "|")
                .ok_or_else(|| {
                    SourcePolicyError::InvalidContract(format!(
                        "SynthDef {name} is missing a control block"
                    ))
                })?;
            let control_end = slice[control_start + 1..]
                .iter()
                .position(|token| token.kind == TokenKind::Punctuation && token.text == "|")
                .map(|offset| control_start + 1 + offset)
                .ok_or_else(|| {
                    SourcePolicyError::InvalidContract(format!(
                        "SynthDef {name} has an unterminated control block"
                    ))
                })?;
            let controls = &slice[control_start + 1..control_end];
            for control in ["out", "amp", "gate", "pan"] {
                if !controls
                    .iter()
                    .any(|token| token.kind == TokenKind::Identifier && token.text == control)
                {
                    return Err(SourcePolicyError::InvalidContract(format!(
                        "SynthDef {name} is missing {control} control"
                    )));
                }
            }
            if !slice.iter().any(|token| token.text == "EnvGen") {
                return Err(SourcePolicyError::InvalidContract(format!(
                    "SynthDef {name} is missing EnvGen"
                )));
            }
            let has_free_self = slice.windows(2).any(|pair| {
                pair[0].text == "Done"
                    && pair[1].kind == TokenKind::Selector
                    && pair[1].text == ".freeSelf"
            });
            if !has_free_self {
                return Err(SourcePolicyError::InvalidContract(format!(
                    "SynthDef {name} is missing Done.freeSelf"
                )));
            }
            synth_def_names.push(name.to_owned());
        }

        Ok(SourceValidation { synth_def_names })
    }

    pub fn namespace_synth_defs(
        &self,
        source: &str,
        namespace: &str,
    ) -> Result<String, SourcePolicyError> {
        self.validate(source)?;
        if namespace.is_empty()
            || !namespace
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
        {
            return Err(SourcePolicyError::InvalidNamespace(namespace.into()));
        }
        let tokens = tokenize(source);
        let mut rewritten = String::with_capacity(source.len() + 32);
        let mut cursor = 0;
        for token in tokens {
            rewritten.push_str(&source[cursor..token.start]);
            if token.kind == TokenKind::Symbol
                && matches!(
                    token.text,
                    "\\lyra_voice_1" | "\\lyra_voice_2" | "\\lyra_voice_3" | "\\lyra_voice_4"
                )
            {
                let suffix = token.text.trim_start_matches("\\lyra_");
                rewritten.push('\\');
                rewritten.push_str(namespace);
                rewritten.push('_');
                rewritten.push_str(suffix);
            } else {
                rewritten.push_str(token.text);
            }
            cursor = token.end;
        }
        rewritten.push_str(&source[cursor..]);
        Ok(rewritten)
    }
}

fn require_identifier(tokens: &[Token<'_>], required: &str) -> Result<(), SourcePolicyError> {
    if tokens
        .iter()
        .any(|token| token.kind == TokenKind::Identifier && token.text == required)
    {
        Ok(())
    } else {
        Err(SourcePolicyError::InvalidContract(format!(
            "missing {required}"
        )))
    }
}

fn tokenize(source: &str) -> Vec<Token<'_>> {
    let bytes = source.as_bytes();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index].is_ascii_whitespace() {
            index += 1;
            continue;
        }
        let start = index;
        let (kind, end) = if bytes[index] == b'/' && bytes.get(index + 1) == Some(&b'/') {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            (TokenKind::Comment, index)
        } else if bytes[index] == b'/' && bytes.get(index + 1) == Some(&b'*') {
            index += 2;
            while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/') {
                index += 1;
            }
            index = (index + 2).min(bytes.len());
            (TokenKind::Comment, index)
        } else if bytes[index] == b'"' {
            index += 1;
            while index < bytes.len() {
                if bytes[index] == b'\\' {
                    index = (index + 2).min(bytes.len());
                } else if bytes[index] == b'"' {
                    index += 1;
                    break;
                } else {
                    index += 1;
                }
            }
            (TokenKind::String, index)
        } else if bytes[index] == b'\\' {
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_')
            {
                index += 1;
            }
            (TokenKind::Symbol, index)
        } else if bytes[index] == b'.'
            && bytes
                .get(index + 1)
                .is_some_and(|byte| byte.is_ascii_alphabetic())
        {
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_')
            {
                index += 1;
            }
            (TokenKind::Selector, index)
        } else if bytes[index].is_ascii_alphabetic() || matches!(bytes[index], b'_' | b'~') {
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_')
            {
                index += 1;
            }
            (TokenKind::Identifier, index)
        } else if bytes[index].is_ascii_digit() {
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_digit()
                    || matches!(bytes[index], b'.' | b'e' | b'E' | b'-'))
            {
                index += 1;
            }
            (TokenKind::Number, index)
        } else {
            index += 1;
            (TokenKind::Punctuation, index)
        };
        tokens.push(Token {
            kind,
            text: &source[start..end],
            start,
            end,
        });
    }
    tokens
}
