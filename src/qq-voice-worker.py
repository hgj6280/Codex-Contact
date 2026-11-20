"""One synthesis per process; model/GPU memory is released when this exits."""
import json, os, re
import numpy as np
import soundfile as sf
import mlx.core as mx
from mlx_audio.tts.utils import load_model
from mlx_audio.tts.generate import load_audio

request = json.loads(os.environ['QQ_VOICE_REQUEST'])
mx.set_cache_limit(64 * 1024 * 1024)
model = load_model('mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit')
reference = load_audio(request['reference'], sample_rate=model.sample_rate)
chunks = []
# Short sentences avoid prosody drift; one model load still handles the whole clip.
segments = []
for phrase in [s.strip() for s in re.split(r'(?<=[。！？!?])\s*|\n+', request['text']) if s.strip()]:
    while len(phrase) > 160:
        boundary = max(phrase.rfind('，', 70, 160), phrase.rfind(' ', 70, 160))
        boundary = boundary + 1 if boundary >= 70 else 160
        segments.append(phrase[:boundary])
        phrase = phrase[boundary:]
    if phrase.strip():
        segments.append(phrase)
for segment in segments:
    for result in model.generate(segment, ref_audio=reference,
                                 ref_text=request['transcript'], lang_code='Chinese',
                                 temperature=0.65, top_p=0.9, top_k=30,
                                 repetition_penalty=1.05, max_tokens=650):
        audio = np.asarray(result.audio, dtype=np.float32).reshape(-1)
        if not np.isfinite(audio).all() or audio.size < model.sample_rate * 0.15:
            raise RuntimeError('Invalid synthesized audio')
        # Remove DC and soften boundaries. Never boost quiet output into clipping.
        audio = audio - np.mean(audio)
        peak = float(np.max(np.abs(audio)))
        if peak > 0.88:
            audio *= 0.88 / peak
        fade = min(int(model.sample_rate * 0.008), audio.size // 2)
        audio[:fade] *= np.linspace(0, 1, fade)
        audio[-fade:] *= np.linspace(1, 0, fade)
        if chunks:
            chunks.append(np.zeros(int(model.sample_rate * 0.12), dtype=np.float32))
        chunks.append(audio)
if not chunks:
    raise RuntimeError('No audio generated')
audio = np.concatenate(chunks)
if audio.size > model.sample_rate * min(95, int(request.get('max_seconds', 35))):
    raise RuntimeError('Synthesized speech was abnormally long')
audio = np.concatenate([audio, np.zeros(int(model.sample_rate * 0.1), dtype=np.float32)])
sf.write(request['output'], audio, model.sample_rate, subtype='PCM_16')
