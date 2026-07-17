use std::collections::HashSet;
use thiserror::Error;

const MAX_SOURCE_BYTES: usize = 48 * 1024;
const SEED_PLACEHOLDER: &str = "__LYRA_SEED__";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceValidation {
    pub voice_count: usize,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SourcePolicyError {
    #[error("source exceeds 48 KiB")]
    SourceTooLarge,
    #[error("forbidden identifier: {0}")]
    ForbiddenIdentifier(String),
    #[error("class is not allowed: {0}")]
    UnknownClass(String),
    #[error("invalid track contract: {0}")]
    InvalidContract(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenKind {
    Identifier,
    Number,
    String,
    Comment,
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
    forbidden_identifiers: HashSet<&'static str>,
}

impl SourcePolicy {
    pub fn v1() -> Self {
        Self {
            allowed_classes: [
                "Math", "Std", "SinOsc", "TriOsc", "SawOsc", "PulseOsc", "Blit", "Noise", "CNoise",
                "ADSR", "Envelope", "LPF", "HPF", "BPF", "BRF", "ResonZ", "DelayL", "Echo",
                "JCRev", "NRev", "Chorus", "Pan2", "Gain", "Dyno",
            ]
            .into_iter()
            .collect(),
            forbidden_identifiers: [
                "adc", "File", "FileIO", "Machine", "MidiIn", "MidiOut", "HidIn", "HidOut",
                "OscIn", "OscOut", "SerialIO", "SndBuf", "LiSa", "WaveLoop", "KBHit", "me",
                "chout", "cherr",
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
        let code: Vec<&Token<'_>> = tokens
            .iter()
            .filter(|token| !matches!(token.kind, TokenKind::Comment | TokenKind::String))
            .collect();

        for token in &code {
            if token.kind != TokenKind::Identifier {
                continue;
            }
            if self.forbidden_identifiers.contains(token.text) {
                return Err(SourcePolicyError::ForbiddenIdentifier(token.text.into()));
            }
            if token.text.chars().next().is_some_and(char::is_uppercase)
                && !self.allowed_classes.contains(token.text)
            {
                return Err(SourcePolicyError::UnknownClass(token.text.into()));
            }
        }

        validate_delimiters(&code)?;
        reject_additional_loop_forms(&code)?;
        validate_audio_parameter_ranges(&code)?;
        require_identifier(&code, "dac")?;
        let placeholders = code
            .iter()
            .filter(|token| token.kind == TokenKind::Identifier && token.text == SEED_PLACEHOLDER)
            .count();
        if placeholders != 1 || !contains_seed_call(&code) {
            return Err(SourcePolicyError::InvalidContract(
                "source must contain exactly Math.srandom(__LYRA_SEED__)".into(),
            ));
        }

        let loops = loop_blocks(&code)?;
        if !(1..=4).contains(&loops.len()) {
            return Err(SourcePolicyError::InvalidContract(
                "track must contain 1 to 4 voice loops".into(),
            ));
        }
        for (index, (open, close)) in loops.iter().copied().enumerate() {
            if loops
                .iter()
                .enumerate()
                .any(|(other, (nested_open, nested_close))| {
                    other != index && *nested_open > open && *nested_close < close
                })
            {
                return Err(SourcePolicyError::InvalidContract(
                    "nested loops are not allowed".into(),
                ));
            }
            let advances = bounded_time_advances(&code[open + 1..close])?;
            if advances != 1 {
                return Err(SourcePolicyError::InvalidContract(
                    "each voice loop must contain exactly one bounded duration => now".into(),
                ));
            }
        }
        reject_recursion(&code)?;

        Ok(SourceValidation {
            voice_count: loops.len(),
        })
    }

    pub fn inject_seed(&self, source: &str, seed: i64) -> Result<String, SourcePolicyError> {
        self.validate(source)?;
        let tokens = tokenize(source);
        let token = tokens
            .iter()
            .find(|token| token.kind == TokenKind::Identifier && token.text == SEED_PLACEHOLDER)
            .ok_or_else(|| {
                SourcePolicyError::InvalidContract("seed placeholder is missing".into())
            })?;
        let mut result = String::with_capacity(source.len());
        result.push_str(&source[..token.start]);
        result.push_str(&seed.to_string());
        result.push_str(&source[token.end..]);
        Ok(result)
    }
}

fn require_identifier(tokens: &[&Token<'_>], name: &str) -> Result<(), SourcePolicyError> {
    tokens
        .iter()
        .any(|token| token.kind == TokenKind::Identifier && token.text == name)
        .then_some(())
        .ok_or_else(|| SourcePolicyError::InvalidContract(format!("missing {name}")))
}

fn contains_seed_call(tokens: &[&Token<'_>]) -> bool {
    tokens.windows(7).any(|window| {
        window[0].text == "Math"
            && window[1].text == "."
            && window[2].text == "srandom"
            && window[3].text == "("
            && window[4].text == SEED_PLACEHOLDER
            && window[5].text == ")"
            && window[6].text == ";"
    })
}

fn validate_delimiters(tokens: &[&Token<'_>]) -> Result<(), SourcePolicyError> {
    let mut stack = Vec::new();
    for token in tokens {
        match token.text {
            "(" | "{" | "[" => stack.push(token.text),
            ")" | "}" | "]" => {
                let expected = match token.text {
                    ")" => "(",
                    "}" => "{",
                    _ => "[",
                };
                if stack.pop() != Some(expected) {
                    return Err(SourcePolicyError::InvalidContract(
                        "unbalanced delimiter".into(),
                    ));
                }
            }
            _ => {}
        }
    }
    if stack.is_empty() {
        Ok(())
    } else {
        Err(SourcePolicyError::InvalidContract(
            "unbalanced delimiter".into(),
        ))
    }
}

fn loop_blocks(tokens: &[&Token<'_>]) -> Result<Vec<(usize, usize)>, SourcePolicyError> {
    let mut loops = Vec::new();
    for (index, token) in tokens.iter().enumerate() {
        if token.kind != TokenKind::Identifier || token.text != "while" {
            continue;
        }
        if tokens.get(index + 1).map(|token| token.text) != Some("(")
            || tokens.get(index + 2).map(|token| token.text) != Some("true")
            || tokens.get(index + 3).map(|token| token.text) != Some(")")
            || tokens.get(index + 4).map(|token| token.text) != Some("{")
        {
            return Err(SourcePolicyError::InvalidContract(
                "each voice loop must use while (true)".into(),
            ));
        }
        let open = index + 4;
        let close = matching_delimiter(tokens, open, "{", "}")?;
        loops.push((open, close));
    }
    Ok(loops)
}

fn reject_additional_loop_forms(tokens: &[&Token<'_>]) -> Result<(), SourcePolicyError> {
    if let Some(token) = tokens.iter().find(|token| {
        token.kind == TokenKind::Identifier
            && matches!(token.text, "for" | "do" | "repeat" | "until")
    }) {
        return Err(SourcePolicyError::InvalidContract(format!(
            "additional loop form is not allowed: {}",
            token.text
        )));
    }
    Ok(())
}

fn validate_audio_parameter_ranges(tokens: &[&Token<'_>]) -> Result<(), SourcePolicyError> {
    for (index, token) in tokens.iter().enumerate() {
        if token.text != "="
            || tokens.get(index + 1).map(|token| token.text) != Some(">")
            || tokens.get(index + 3).map(|token| token.text) != Some(".")
        {
            continue;
        }
        let Some(property) = tokens.get(index + 4).map(|token| token.text) else {
            continue;
        };
        let Some(number) = index.checked_sub(1).and_then(|offset| tokens.get(offset)) else {
            continue;
        };
        if number.kind != TokenKind::Number {
            continue;
        }
        let mut value: f64 = number.text.parse().map_err(|_| {
            SourcePolicyError::InvalidContract(format!(
                "{property} must use a finite numeric literal"
            ))
        })?;
        if index >= 2 && tokens[index - 2].text == "-" {
            value = -value;
        }
        let allowed = match property {
            "gain" => (0.0..=1.0).contains(&value),
            "freq" => (0.01..=20_000.0).contains(&value),
            "pan" => (-1.0..=1.0).contains(&value),
            "mix" | "width" => (0.0..=1.0).contains(&value),
            "feedback" => (0.0..=0.99).contains(&value),
            _ => continue,
        };
        if !value.is_finite() || !allowed {
            return Err(SourcePolicyError::InvalidContract(format!(
                "audio parameter is out of range: {property}={value}"
            )));
        }
    }
    Ok(())
}

fn matching_delimiter(
    tokens: &[&Token<'_>],
    open_index: usize,
    open: &str,
    close: &str,
) -> Result<usize, SourcePolicyError> {
    let mut depth = 0;
    for (index, token) in tokens.iter().enumerate().skip(open_index) {
        if token.text == open {
            depth += 1;
        }
        if token.text == close {
            depth -= 1;
            if depth == 0 {
                return Ok(index);
            }
        }
    }
    Err(SourcePolicyError::InvalidContract(
        "unbalanced delimiter".into(),
    ))
}

fn bounded_time_advances(tokens: &[&Token<'_>]) -> Result<usize, SourcePolicyError> {
    let mut count = 0;
    for window in tokens.windows(7) {
        if window[0].kind == TokenKind::Number
            && window[1].text == ":"
            && window[2].text == ":"
            && window[3].kind == TokenKind::Identifier
            && window[4].text == "="
            && window[5].text == ">"
            && window[6].text == "now"
        {
            let value: f64 = window[0].text.parse().map_err(|_| {
                SourcePolicyError::InvalidContract("duration must be numeric".into())
            })?;
            let milliseconds = match window[3].text {
                "ms" => value,
                "second" => value * 1000.0,
                "samp" => value / 44.1,
                unit => {
                    return Err(SourcePolicyError::InvalidContract(format!(
                        "duration unit is not allowed: {unit}"
                    )))
                }
            };
            if !milliseconds.is_finite() || !(1.0..=10_000.0).contains(&milliseconds) {
                return Err(SourcePolicyError::InvalidContract(
                    "duration must be between 1 ms and 10 seconds".into(),
                ));
            }
            count += 1;
        }
    }
    Ok(count)
}

fn reject_recursion(tokens: &[&Token<'_>]) -> Result<(), SourcePolicyError> {
    for (index, token) in tokens.iter().enumerate() {
        if token.text != "fun" {
            continue;
        }
        let Some(name_index) = tokens[index + 1..]
            .iter()
            .position(|candidate| candidate.text == "(")
            .map(|offset| index + offset)
        else {
            continue;
        };
        let name = tokens[name_index].text;
        let Some(open) = tokens[name_index + 1..]
            .iter()
            .position(|candidate| candidate.text == "{")
            .map(|offset| name_index + 1 + offset)
        else {
            continue;
        };
        let close = matching_delimiter(tokens, open, "{", "}")?;
        if tokens[open + 1..close]
            .iter()
            .any(|candidate| candidate.kind == TokenKind::Identifier && candidate.text == name)
        {
            return Err(SourcePolicyError::InvalidContract(format!(
                "recursive function is not allowed: {name}"
            )));
        }
    }
    Ok(())
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
        } else if bytes[index].is_ascii_alphabetic() || bytes[index] == b'_' {
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_')
            {
                index += 1;
            }
            (TokenKind::Identifier, index)
        } else if bytes[index].is_ascii_digit()
            || (bytes[index] == b'.' && bytes.get(index + 1).is_some_and(u8::is_ascii_digit))
        {
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_digit()
                    || matches!(bytes[index], b'.' | b'e' | b'E' | b'+' | b'-'))
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
