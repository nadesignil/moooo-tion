import {useEffect, useRef, useState} from 'react';
import {IconPlayerPlayFilled, IconPlayerStopFilled} from '@tabler/icons-react';
import {clock, sec2} from '../format';

const BINS = 480;

type Wave = {peaks: Float32Array; seconds: number};
// a track decodes once per session: reopening the settings is instant
const waves = new Map<string, Promise<Wave>>();

/** loudness per bin (max |sample| over every channel), 0..1 */
const decode = async (buf: ArrayBuffer): Promise<Wave> => {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const peaks = new Float32Array(BINS);
    const step = audio.length / BINS;
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const data = audio.getChannelData(c);
      for (let i = 0; i < BINS; i++) {
        let m = 0;
        const end = Math.min(data.length, Math.floor((i + 1) * step));
        // every 16th sample is plenty for a picture
        for (let j = Math.floor(i * step); j < end; j += 16) {
          const v = Math.abs(data[j]);
          if (v > m) m = v;
        }
        if (m > peaks[i]) peaks[i] = m;
      }
    }
    const top = peaks.reduce((a, b) => Math.max(a, b), 0) || 1;
    for (let i = 0; i < BINS; i++) peaks[i] /= top;
    return {peaks, seconds: audio.duration};
  } finally {
    ctx.close().catch(() => undefined);
  }
};

const waveOf = (key: string, load: () => Promise<ArrayBuffer>) => {
  let w = waves.get(key);
  if (!w) {
    w = load().then(decode);
    waves.set(key, w);
    w.catch(() => waves.delete(key));
  }
  return w;
};

/** one path of mirrored bars — cheap to draw and themed by CSS (fill: currentColor) */
const wavePath = (peaks: Float32Array) => {
  let d = '';
  for (let i = 0; i < peaks.length; i++) {
    const h = Math.max(0.6, peaks[i] * 23);
    d += `M${i} ${24 - h}h0.62v${h * 2}h-0.62z`;
  }
  return d;
};

/**
 * Where the track starts playing: click or drag on the waveform, or type the second.
 * The dimmed part is cut off; the bright part is what plays under the video (`seconds` long).
 */
export const TrackTrim: React.FC<{
  /** a server url (/files/…) or the file just picked in the form */
  src: string | File;
  from: number;
  onChange: (from: number) => void;
  /** the video's length — the part of the track that will play */
  seconds?: number;
}> = ({src, from, onChange, seconds}) => {
  const [wave, setWave] = useState<Wave | null>(null);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [playing, setPlaying] = useState(false);
  const [head, setHead] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setWave(null);
    setError('');
    const isFile = typeof src !== 'string';
    const u = isFile ? URL.createObjectURL(src) : src;
    setUrl(u);
    const key = isFile ? `file:${src.name}:${src.size}:${src.lastModified}` : src;
    let alive = true;
    waveOf(key, () => (isFile ? src.arrayBuffer() : fetch(u).then((r) => r.arrayBuffer())))
      .then((w) => alive && setWave(w))
      .catch(() => alive && setError('Не удалось прочитать трек — начало можно задать числом'));
    return () => {
      alive = false;
      if (isFile) URL.revokeObjectURL(u);
    };
  }, [src]);

  // the playhead follows the audio while it plays
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a) setHead(a.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const total = wave?.seconds ?? 0;
  // before the track is read its length is unknown: only «not below zero»
  const clamp = (t: number) => Math.round(Math.max(0, total ? Math.min(t, total - 0.5) : t) * 100) / 100;

  const play = (at = from) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = at;
    a.play().then(() => setPlaying(true)).catch(() => undefined);
  };
  const stop = () => {
    audioRef.current?.pause();
    setPlaying(false);
    setHead(null);
  };

  const timeAt = (clientX: number) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || !total) return from;
    return clamp(((clientX - r.left) / r.width) * total);
  };

  const pct = (t: number) => `${total ? (t / total) * 100 : 0}%`;
  const take = seconds && total ? Math.min(seconds, total - from) : 0;

  return (
    <div className="track-trim">
      <audio ref={audioRef} src={url || undefined} preload="auto" onEnded={stop} />
      <div
        ref={boxRef}
        className={`trim-wave ${wave ? '' : 'loading'}`}
        title="Нажмите или потяните — отсюда трек начнёт играть"
        onPointerDown={(e) => {
          if (!wave) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          onChange(timeAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (wave && e.currentTarget.hasPointerCapture(e.pointerId)) onChange(timeAt(e.clientX));
        }}
        onPointerUp={(e) => {
          if (!wave) return;
          const t = timeAt(e.clientX);
          // a new start while listening: listen from there
          if (playing) play(t);
        }}
      >
        {wave ? (
          <svg viewBox={`0 0 ${BINS} 48`} preserveAspectRatio="none" aria-hidden>
            <path d={wavePath(wave.peaks)} />
          </svg>
        ) : (
          <small>{error || 'Читаю трек…'}</small>
        )}
        {wave ? (
          <>
            <div className="trim-cut" style={{width: pct(from)}} />
            {take > 0 ? <div className="trim-take" style={{left: pct(from), width: pct(take)}} /> : null}
            <div className="trim-start" style={{left: pct(from)}} />
            {head != null ? <div className="trim-head" style={{left: pct(head)}} /> : null}
          </>
        ) : null}
      </div>
      <div className="trim-row">
        <button type="button" className="icon-btn" onClick={() => (playing ? stop() : play())} title={playing ? 'Остановить' : 'Послушать с начала'}>
          {playing ? <IconPlayerStopFilled size={16} /> : <IconPlayerPlayFilled size={16} />}
        </button>
        <label>
          Начать с
          <input
            type="number"
            min={0}
            step={0.05}
            value={from}
            onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
            onKeyDown={(e) => e.stopPropagation()}
          />
          с
        </label>
        <small>
          {total ? `трек ${clock(total)}` : ''}
          {take > 0 ? ` · в ролик войдёт ${sec2(from)}–${sec2(from + take)} с` : ''}
        </small>
      </div>
    </div>
  );
};
