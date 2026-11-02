#!/bin/bash
# 全部工况（2 核）：3 mm 网格每个约 1.5 分钟，4 mm 约 40 秒，2 mm 约 15 分钟。已完成的会跳过。
# 页面主数据用 runs3（3 mm）；runs 是 4 mm 上的灵敏度；runs2 是 2 mm 收敛检查。
cd "$(dirname "$0")"; mkdir -p runs runs2 runs3 logs
R() { d=$1; n=$2; dx=$3; shift 3; [ -f $d/$n.done ] || { ./mw3d "$@" $d/$n.bin --dx $dx "${EXTRA[@]}" 2> logs/$d-$n.log && touch $d/$n.done; }; echo "$d/$n ok $(date +%H:%M:%S)"; }
BENTO="rect 200 140 0 0 30"; DISC="disc 240 240 0 0 20"; CUP="disc 84 84 0 0 70"; CUPO="disc 84 84 80 60 70"
LOW=(--feedz 190 --feedy 0); TOP=(--feedz 290 --feedy -40); P2=(--plate 1)

# ---- 3 mm：页面主数据 ----
A="36 10 3"
EXTRA=(--record); R runs3 a_rect 3 antenna $BENTO 36 16 3; R runs3 t_rect 3 turntable $BENTO 36 16 3
EXTRA=()
R runs3 a_disc 3 antenna $DISC $A;  R runs3 t_disc 3 turntable $DISC $A
R runs3 a_cup  3 antenna $CUP $A;   R runs3 t_cup  3 turntable $CUP $A
R runs3 a_cupo 3 antenna $CUPO $A;  R runs3 t_cupo 3 turntable $CUPO $A
EXTRA=("${LOW[@]}"); R runs3 t_low 3 turntable $BENTO $A; R runs3 t_disc_low 3 turntable $DISC $A; R runs3 t_cup_low 3 turntable $CUP $A; R runs3 t_cupo_low 3 turntable $CUPO $A
EXTRA=("${TOP[@]}"); R runs3 t_top 3 turntable $BENTO $A; R runs3 t_disc_top 3 turntable $DISC $A; R runs3 t_cup_top 3 turntable $CUP $A; R runs3 t_cupo_top 3 turntable $CUPO $A
EXTRA=("${P2[@]}");  R runs3 a_rect_p2 3 antenna $BENTO $A; R runs3 a_disc_p2 3 antenna $DISC $A; R runs3 a_cup_p2 3 antenna $CUP $A; R runs3 a_cupo_p2 3 antenna $CUPO $A

# ---- 4 mm：网格对比和其他条件的灵敏度 ----
A="36 16 3"
EXTRA=(); R runs a_rect 4 antenna $BENTO $A; R runs t_rect 4 turntable $BENTO $A
EXTRA=(--freq 2.44); R runs a_f244 4 antenna $BENTO $A; R runs t_f244 4 turntable $BENTO $A
EXTRA=(--freq 2.46); R runs a_f246 4 antenna $BENTO $A; R runs t_f246 4 turntable $BENTO $A
EXTRA=(); R runs a_settle 4 antenna $BENTO 36 40 3
EXTRA=(--rodz 70); R runs a_rod70 4 antenna $BENTO $A
EXTRA=(--rodz 74); R runs a_rod74 4 antenna $BENTO $A

# ---- 2 mm：网格收敛检查 ----
EXTRA=(); R runs2 a_rect 2 antenna $BENTO 18 16 3; R runs2 t_rect 2 turntable $BENTO 18 16 3
echo ALLDONE
