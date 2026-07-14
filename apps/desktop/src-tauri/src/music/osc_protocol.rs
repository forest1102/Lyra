use thiserror::Error;

#[derive(Debug, Clone, PartialEq)]
pub enum OscArgument {
    String(String),
    Int(i32),
    Int64(i64),
    Float(f32),
}

#[derive(Debug, Clone, PartialEq)]
pub struct OscMessage {
    pub address: String,
    pub arguments: Vec<OscArgument>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum OscDecodeError {
    #[error("OSC packet is truncated")]
    Truncated,
    #[error("OSC string is not valid UTF-8")]
    InvalidUtf8,
    #[error("OSC type tag is invalid: {0}")]
    InvalidType(char),
    #[error("OSC type tag string must start with a comma")]
    MissingTypePrefix,
}

pub fn encode_message(message: &OscMessage) -> Vec<u8> {
    let mut output = Vec::new();
    push_string(&mut output, &message.address);
    let mut type_tags = String::from(",");
    for argument in &message.arguments {
        type_tags.push(match argument {
            OscArgument::String(_) => 's',
            OscArgument::Int(_) => 'i',
            OscArgument::Int64(_) => 'h',
            OscArgument::Float(_) => 'f',
        });
    }
    push_string(&mut output, &type_tags);
    for argument in &message.arguments {
        match argument {
            OscArgument::String(value) => push_string(&mut output, value),
            OscArgument::Int(value) => output.extend_from_slice(&value.to_be_bytes()),
            OscArgument::Int64(value) => output.extend_from_slice(&value.to_be_bytes()),
            OscArgument::Float(value) => output.extend_from_slice(&value.to_bits().to_be_bytes()),
        }
    }
    output
}

pub fn decode_message(packet: &[u8]) -> Result<OscMessage, OscDecodeError> {
    let (address, mut cursor) = read_string(packet, 0)?;
    let (type_tags, next) = read_string(packet, cursor)?;
    cursor = next;
    let tags = type_tags
        .strip_prefix(',')
        .ok_or(OscDecodeError::MissingTypePrefix)?;
    let mut arguments = Vec::with_capacity(tags.len());
    for tag in tags.chars() {
        let argument = match tag {
            's' => {
                let (value, next) = read_string(packet, cursor)?;
                cursor = next;
                OscArgument::String(value)
            }
            'i' => {
                let bytes = read_fixed::<4>(packet, cursor)?;
                cursor += 4;
                OscArgument::Int(i32::from_be_bytes(bytes))
            }
            'h' => {
                let bytes = read_fixed::<8>(packet, cursor)?;
                cursor += 8;
                OscArgument::Int64(i64::from_be_bytes(bytes))
            }
            'f' => {
                let bytes = read_fixed::<4>(packet, cursor)?;
                cursor += 4;
                OscArgument::Float(f32::from_bits(u32::from_be_bytes(bytes)))
            }
            other => return Err(OscDecodeError::InvalidType(other)),
        };
        arguments.push(argument);
    }
    Ok(OscMessage { address, arguments })
}

fn push_string(output: &mut Vec<u8>, value: &str) {
    output.extend_from_slice(value.as_bytes());
    output.push(0);
    while output.len() % 4 != 0 {
        output.push(0);
    }
}

fn read_string(packet: &[u8], start: usize) -> Result<(String, usize), OscDecodeError> {
    let relative_end = packet
        .get(start..)
        .ok_or(OscDecodeError::Truncated)?
        .iter()
        .position(|byte| *byte == 0)
        .ok_or(OscDecodeError::Truncated)?;
    let end = start + relative_end;
    let value = std::str::from_utf8(&packet[start..end])
        .map_err(|_| OscDecodeError::InvalidUtf8)?
        .to_owned();
    let next = (end + 4) & !3;
    if next > packet.len() {
        return Err(OscDecodeError::Truncated);
    }
    Ok((value, next))
}

fn read_fixed<const N: usize>(packet: &[u8], start: usize) -> Result<[u8; N], OscDecodeError> {
    packet
        .get(start..start + N)
        .ok_or(OscDecodeError::Truncated)?
        .try_into()
        .map_err(|_| OscDecodeError::Truncated)
}
