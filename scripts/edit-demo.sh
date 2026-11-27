#!/usr/bin/env bash
# Cuts the product-tour video from the raw take of scripts/record-demo.mjs.
#
# Usage:
#   bash scripts/edit-demo.sh [WORK_DIR] [OUT_DIR]
#     WORK_DIR  output of record-demo.mjs (raw.webm, chapters.json, cards/)   default: $TMPDIR/command-center-demo
#     OUT_DIR   where the web files go                                       default: docs/media
#   Environment: CRF (default 24; lower = larger and sharper), PRESET (default slow), FADE (seconds, default 0.35).
#
# Edit: title card → one segment per chapter (trimmed to the chapter's marks, lower-third caption fading in and out
# for a few seconds once the chapter's screen is shown, short fade from and to black at each cut) → end card. Segments are encoded at high quality,
# joined with the concat demuxer, then encoded once for the web: H.264 High, yuv420p, 25 fps, 1440x900, no audio,
# +faststart (playback starts before the download ends). Also writes a poster frame (JPEG and WebP).
#
# Outputs: OUT_DIR/command-center-demo.mp4, -poster.jpg, -poster.webp and .chapters.vtt (chapter cues for the page)
# Needs: ffmpeg/ffprobe with libx264 (libwebp optional), python3 (to read chapters.json).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:-${TMPDIR:-/tmp}/command-center-demo}"
OUT="${2:-$ROOT/docs/media}"
CRF="${CRF:-24}"
PRESET="${PRESET:-slow}"
FADE="${FADE:-0.35}"
TITLE_SECONDS=4.5
END_SECONDS=4
CAPTION_DELAY=0.3   # lower third appears this long after the chapter's own screen does (chapters.json "caption")
CAPTION_HOLD=4.2    # and stays this long before fading out
SEG="$WORK/segments"

[[ -f "$WORK/raw.webm" && -f "$WORK/chapters.json" ]] || { echo "Run scripts/record-demo.mjs first (no raw.webm/chapters.json in $WORK)" >&2; exit 1; }
mkdir -p "$OUT"
rm -rf "$SEG" && mkdir -p "$SEG"

# Common settings for intermediate segments: visually lossless, fast, identical stream parameters for concat.
ENC_MID=(-an -c:v libx264 -preset veryfast -crf 12 -pix_fmt yuv420p -r 25 -video_track_timescale 12800)

# A still card that fades in from black and out to black.
card() { # <png> <seconds> <out>
  local d="$2"
  ffmpeg -nostdin -v error -y -loop 1 -t "$d" -i "$1" \
    -vf "format=yuv420p,fade=t=in:st=0:d=0.6,fade=t=out:st=$(awk "BEGIN{print $d-0.6}"):d=0.6" "${ENC_MID[@]}" "$3"
}

card "$WORK/cards/title.png" "$TITLE_SECONDS" "$SEG/000-title.mp4"

# One line per chapter: index id start end caption (seconds into raw.webm; caption is relative to start).
python3 -c '
import json, sys
for i, c in enumerate(json.load(open(sys.argv[1]))["chapters"], 1):
    print(i, c["id"], c["start"], c["end"], c.get("caption", 0.5))
' "$WORK/chapters.json" | while read -r i id start end caption; do
  dur=$(awk "BEGIN{print $end-$start}")
  out_at=$(awk "BEGIN{print $dur-$FADE}")
  lt_in=$(awk "BEGIN{print $caption+$CAPTION_DELAY}")
  lt_out=$(awk "BEGIN{print $lt_in+$CAPTION_HOLD}")
  printf '  %-13s %6.2f → %6.2f  (%5.2f s)\n' "$id" "$start" "$end" "$dur"
  # -ss after -i: frame-accurate trim of the webm. The caption PNG is looped for the segment's length and faded
  # through its alpha channel, then the whole segment fades from/to black.
  ffmpeg -nostdin -v error -y -i "$WORK/raw.webm" -loop 1 -i "$WORK/cards/lt-$id.png" -filter_complex "
    [0:v]trim=start=$start:end=$end,setpts=PTS-STARTPTS,fps=25[v];
    [1:v]format=rgba,trim=duration=$dur,setpts=PTS-STARTPTS,
      fade=t=in:st=$lt_in:d=0.45:alpha=1,fade=t=out:st=$lt_out:d=0.45:alpha=1[lt];
    [v][lt]overlay=0:0:shortest=1,format=yuv420p,fade=t=in:st=0:d=$FADE,fade=t=out:st=$out_at:d=$FADE[o]" \
    -map "[o]" "${ENC_MID[@]}" "$SEG/$(printf %03d "$i")-$id.mp4"
done

card "$WORK/cards/end.png" "$END_SECONDS" "$SEG/999-end.mp4"

# Join and encode once for the web.
( cd "$SEG" && for f in *.mp4; do echo "file '$f'"; done ) > "$SEG/list.txt"
MP4="$OUT/command-center-demo.mp4"
ffmpeg -nostdin -v error -y -f concat -safe 0 -i "$SEG/list.txt" -an \
  -c:v libx264 -preset "$PRESET" -crf "$CRF" -tune stillimage -profile:v high -level 4.1 \
  -pix_fmt yuv420p -r 25 -g 250 -movflags +faststart "$MP4"

# Poster: a frame from the incident chapter (the app at its most telling), else from the middle of the video.
POSTER_AT=$(python3 -c '
import json, sys
d = json.load(open(sys.argv[1])); t = 4.5
for c in d["chapters"]:
    if c["id"] == "incident": print(round(t + (c["end"] - c["start"]) * 0.3, 2)); break
    t += c["end"] - c["start"]
else: print(round(t / 2, 2))
' "$WORK/chapters.json")
ffmpeg -nostdin -v error -y -ss "$POSTER_AT" -i "$MP4" -frames:v 1 -q:v 3 "$OUT/command-center-demo-poster.jpg"
ffmpeg -nostdin -v error -y -ss "$POSTER_AT" -i "$MP4" -frames:v 1 -c:v libwebp -quality 82 "$OUT/command-center-demo-poster.webp" 2>/dev/null \
  || echo "(no libwebp: WebP poster skipped)"

# Chapter track (WebVTT) with the final timings: the project page builds its chapter buttons from it.
python3 -c '
import json, sys
fmt = lambda s: "%02d:%02d:%06.3f" % (s // 3600, s % 3600 // 60, s % 60)
t = float(sys.argv[2]); out = ["WEBVTT", ""]
for c in json.load(open(sys.argv[1]))["chapters"]:
    d = round(c["end"] - c["start"], 2)
    out += [fmt(t) + " --> " + fmt(t + d), c["title"], ""]
    t += d
open(sys.argv[3], "w").write("\n".join(out))
' "$WORK/chapters.json" "$TITLE_SECONDS" "$OUT/command-center-demo.chapters.vtt"

DUR=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$MP4")
SIZE=$(du -h "$MP4" | cut -f1)
echo "→ $MP4  ${DUR%.*} s, $SIZE (CRF $CRF, preset $PRESET); poster at ${POSTER_AT}s"
