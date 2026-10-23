#!/usr/bin/env bash
# sample-v3.sh — 5x5 patches, new coords, all three channels per LED
set -e

SIZE=5
HALF=$((SIZE / 2))

# Reference coords from DSC03679 (bright blue) — CENTRES of the 5x5.
# Slot 0 (button1_0) skipped as before.
COORDS=(
  3276 1098
  3447 1362
  2586  730
  2741  985
  2901 1247
  3067 1517
  2208  871
  2357 1131
  2514 1403
  2676 1684
  1071 1288
  1205 1570
  1342 1862
  1487 2168
   894 1350
  1025 1636
  1163 1934
  1305 2245
   717 1416
   844 1703
   978 2004
  1118 2320
   537 1484
   661 1776
)

# Emit one line per lit LED: "R G B" (raw 16-bit DN).
# Caller's scheme block header carries the hw values, in order.
sample() {
  local img="$1" xoff="$2" yoff="$3" limit="$4"
  local n=0
  for ((i=0; i<${#COORDS[@]}; i+=2)); do
    n=$((n + 1))
    [ $n -gt $limit ] && break
    local X=$(( COORDS[$i]      + xoff - HALF ))
    local Y=$(( COORDS[$((i+1))] + yoff - HALF ))
    magick "$img" -crop ${SIZE}x${SIZE}+${X}+${Y} +repage \
      -format "%[fx:mean.r*65535] %[fx:mean.g*65535] %[fx:mean.b*65535]\n" info:
  done
}

{
  echo "calR:";       sample DSC03671.tif  -2 -2 24
  echo "calG:";       sample DSC03672.tif  -2  0 24
  echo "calB:";       sample DSC03673.tif  -3  1 24
  echo "calR_low:";   sample DSC03674.tif  -1  0 15
  echo "calG_low:";   sample DSC03675.tif   0  0 15
  echo "calB_low:";   sample DSC03676.tif  -2  0 15
  echo "calR_high:";  sample DSC03677.tif   0  0 17
  echo "calG_high:";  sample DSC03678.tif   0 -2 17
  echo "calB_high:";  sample DSC03679.tif   0  0 17

  # Dark frame(s). One block per exposure setting actually used.
  # If all signal shots share one exposure, one dark frame is enough.
  # Lens cap on, LEDs off, same exposure as the signal shots.
  echo "dark:";       sample DSC03680.tif   0  0 24
} | tee cal_data_v3.txt
