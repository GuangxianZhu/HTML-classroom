# -*- coding: utf-8 -*-
"""
教学车的电子电气（E/E）数据：盒子、功能、外设、线怎么接。
只有数据，没有 bpy，所以 build_sdv.py 建模和 web/test_model.mjs 校验用的是同一份。

三种架构：
    A 分布式      一个功能一个盒子，靠 CAN/LIN 和中央网关连起来
    B 域集中      逻辑收进 5 个域控制器，但底层 I/O 和信号式通信基本不动
    C 中央+区域   逻辑收进中央计算，按物理位置分 4 个区，区控只管就近的 I/O

坐标：mm。+X 车右，+Y 车头，+Z 朝上，原点在前后轴中点的地面。
这是虚构的教学车，盒子数量和位置只保证量级和逻辑，不对应任何产品。
"""

DOMAINS = {
    'pt': dict(cn='动力', color='#ff9d3c'),
    'ch': dict(cn='底盘', color='#ff6b6b'),
    'bd': dict(cn='车身', color='#ffd166'),
    'ad': dict(cn='智驾', color='#b58cff'),
    'ck': dict(cn='座舱', color='#4cc9f0'),
    'nw': dict(cn='网络', color='#9fb3c8'),
    'zn': dict(cn='区域', color='#3ddc97'),
}

# 虚构供应商。OEM = 整车厂自己
SUPPLIERS = {
    'S1': '动力电控商', 'S2': '电驱商', 'S3': '电池商', 'S4': '充电机商', 'S5': '制动商', 'S6': '转向商',
    'S7': '安全件商', 'S8': '车身电子商', 'S9': '门座模块商', 'S10': '车灯商', 'S11': '空调商',
    'S12': '尾门商', 'S13': '智驾商', 'S14': '座舱商', 'S15': '音响商', 'S16': '通信模组商', 'OEM': '整车厂',
}

# id, 中文, 英文, 域, 位置, 尺寸, 在哪些架构里存在, 供应商, 说明
_E = [
    # ---- 动力
    ('VCU', '整车控制器', 'Vehicle Control Unit', 'pt', (420, 1700, 600), 'm', 'A', 'S1', '把踏板翻译成扭矩请求，协调电机、电池和制动。'),
    ('TMS', '热管理控制', 'Thermal Management', 'pt', (-300, 1850, 560), 's', 'A', 'S1', '管水泵、风扇、压缩机，让电池和电机待在合适温度。'),
    ('INV', '电机控制器', 'Inverter', 'pt', (0, -1400, 575), 'l', 'ABC', 'S2', '矢量控制，电流环约 100 μs 一拍。周期太短，放不到中央去。'),
    ('BMS', '电池管理', 'Battery Management', 'pt', (0, -1090, 352), 'm', 'ABC', 'S3', '监控电芯电压温度，断接触器。保护动作不能指望别的盒子。'),
    ('OBC', '充电机', 'On-Board Charger', 'pt', (-430, -1900, 560), 'l', 'ABC', 'S4', '交流转直流，和充电桩握手，带功率电子。'),
    # ---- 底盘
    ('ESC', '车身稳定', 'Electronic Stability', 'ch', (-560, 1600, 640), 'm', 'ABC', 'S5', 'ABS、牵引力、横摆控制。液压块和阀的闭环全在这里。'),
    ('IBC', '电子助力', 'Brake Booster', 'ch', (-420, 1210, 760), 'm', 'ABC', 'S5', '踩踏板到建压，线控制动的执行端。'),
    ('EPS', '电动转向', 'Power Steering', 'ch', (130, 1330, 340), 'm', 'ABC', 'S6', '方向盘扭矩到助力电机，失效要有冗余。'),
    ('EPB', '电子驻车', 'Parking Brake', 'ch', (0, -1640, 400), 's', 'A', 'S5', '驻车卡钳控制。'),
    ('TPM', '胎压监测', 'Tire Pressure', 'ch', (220, -1760, 480), 's', 'A', 'S8', '接收四个轮胎的无线胎压数据。'),
    ('SRS', '气囊控制', 'Airbag Control', 'ch', (0, 720, 400), 'm', 'ABC', 'S7', '碰撞判断到点火在毫秒级，独立供电、独立判断。'),
    # ---- 车身
    ('BCM', '车身控制器', 'Body Control Module', 'bd', (-690, 960, 560), 'l', 'A', 'S8', '灯、喇叭、中控锁的总管，老车里最忙的盒子。'),
    ('PEP', '无钥匙进入', 'Passive Entry', 'bd', (0, -260, 420), 's', 'A', 'S8', '认钥匙、认手机，决定开不开门。'),
    ('DFL', '左前门控', 'Door Module FL', 'bd', (-845, 640, 640), 's', 'AB', 'S9', '车窗防夹、门锁、后视镜。'),
    ('DFR', '右前门控', 'Door Module FR', 'bd', (845, 640, 640), 's', 'AB', 'S9', '车窗防夹、门锁、后视镜。'),
    ('DRL', '左后门控', 'Door Module RL', 'bd', (-855, -480, 640), 's', 'AB', 'S9', '车窗防夹、门锁。'),
    ('DRR', '右后门控', 'Door Module RR', 'bd', (855, -480, 640), 's', 'AB', 'S9', '车窗防夹、门锁。'),
    ('SCD', '主驾座椅', 'Seat Module D', 'bd', (-370, 120, 395), 's', 'AB', 'S9', '座椅电机、记忆位置、加热。'),
    ('SCP', '副驾座椅', 'Seat Module P', 'bd', (370, 120, 395), 's', 'AB', 'S9', '座椅电机、加热。'),
    ('HVC', '空调控制', 'HVAC Controller', 'bd', (260, 1000, 620), 's', 'A', 'S11', '风门、鼓风机、温区控制。'),
    ('LCL', '左前灯模块', 'Lamp Module L', 'bd', (-710, 2000, 700), 's', 'AB', 'S10', '矩阵光束、转向灯。'),
    ('LCR', '右前灯模块', 'Lamp Module R', 'bd', (710, 2000, 700), 's', 'AB', 'S10', '矩阵光束、转向灯。'),
    ('RLM', '尾灯模块', 'Rear Lamp Module', 'bd', (0, -2260, 870), 's', 'AB', 'S10', '尾灯、刹车灯、转向灯动画。'),
    ('PLG', '电动尾门', 'Power Liftgate', 'bd', (0, -2150, 1035), 's', 'AB', 'S12', '尾门撑杆、防夹。'),
    ('WCM', '雨刮控制', 'Wiper Control', 'bd', (250, 1270, 900), 's', 'A', 'S8', '雨刮和雨量传感器。'),
    # ---- 智驾
    ('FCM', '前视摄像头模块', 'Front Camera Module', 'ad', (0, 640, 1318), 'm', 'A', 'S13', '摄像头和算法封在一起，AEB、车道保持都在里面。'),
    ('APA', '泊车控制器', 'Parking Controller', 'ad', (380, -1950, 560), 'm', 'A', 'S13', '环视和超声波融合，自动泊车。'),
    ('DMS', '驾驶员监测', 'Driver Monitoring', 'ad', (-370, 800, 900), 's', 'A', 'S13', '盯驾驶员眼睛，判断分心和疲劳。'),
    # ---- 座舱
    ('IVI', '车机', 'Infotainment', 'ck', (0, 880, 790), 'l', 'A', 'S14', '中控屏、导航、语音、音乐。'),
    ('ICM', '仪表', 'Instrument Cluster', 'ck', (-370, 900, 860), 'm', 'A', 'S14', '车速和告警。要满足功能安全，常和车机分开。'),
    ('HUD', '抬头显示', 'Head-Up Display', 'ck', (-370, 1010, 905), 's', 'A', 'S14', '把车速投到风挡。'),
    ('AMP', '功放', 'Audio Amplifier', 'ck', (420, -1650, 700), 'm', 'AB', 'S15', '多声道功放和音效。'),
    ('TBX', '远程通信', 'Telematics Box', 'ck', (360, 980, 520), 'm', 'AB', 'S16', '4G/5G、GNSS，车和云之间的门。'),
    # ---- 网络
    ('GW', '中央网关', 'Central Gateway', 'nw', (180, 940, 470), 'm', 'AB', 'S8', '在几条 CAN 之间转发信号，也挡住外来访问。'),
    # ---- B：域控制器
    ('PDC', '动力域控', 'Powertrain Domain', 'pt', (420, 1700, 600), 'l', 'B', 'S1', '合并整车控制和热管理。'),
    ('CDC', '底盘域控', 'Chassis Domain', 'ch', (0, -90, 410), 'l', 'B', 'S5', '合并驻车、胎压和底盘协调。'),
    ('BDC', '车身域控', 'Body Domain', 'bd', (-690, 960, 560), 'l', 'B', 'S8', '合并车身、无钥匙、空调和雨刮逻辑。'),
    ('ADC', '智驾域控', 'ADAS Domain', 'ad', (0, -1850, 500), 'xl', 'B', 'S13', '摄像头进来，算法在这里算。'),
    ('CCU', '座舱域控', 'Cockpit Domain', 'ck', (0, 880, 790), 'xl', 'B', 'S14', '一颗 SoC 跑车机、仪表和抬头显示。'),
    # ---- C：中央 + 区域
    ('CCC', '中央计算', 'Central Compute', 'nw', (0, 830, 640), 'xxl', 'C', 'OEM', '高性能 SoC 跑智驾和座舱，安全 MCU 跑车辆逻辑，靠虚拟化隔开。'),
    ('ZFL', '左前区控', 'Zone Front-Left', 'zn', (-690, 1040, 520), 'z', 'C', 'OEM', '就近驱动左前的灯、门、座椅，把信号变成以太网上的服务。'),
    ('ZFR', '右前区控', 'Zone Front-Right', 'zn', (690, 1040, 520), 'z', 'C', 'OEM', '就近驱动右前的负载。'),
    ('ZRL', '左后区控', 'Zone Rear-Left', 'zn', (-700, -1700, 640), 'z', 'C', 'OEM', '就近驱动左后的负载。'),
    ('ZRR', '右后区控', 'Zone Rear-Right', 'zn', (700, -1700, 640), 'z', 'C', 'OEM', '就近驱动右后的负载。'),
]
ECUS = {e[0]: dict(cn=e[1], en=e[2], dom=e[3], pos=list(e[4]), size=e[5], arch=e[6], sup=e[7], desc=e[8]) for e in _E}

# 总线：A 架构五条 CAN 接到网关；B 里域控之间走以太网，域内还是 CAN；C 里边缘 ECU 就近挂区控
BUSES = {
    'A': {
        '动力 CAN': ['GW', 'VCU', 'TMS', 'INV', 'BMS', 'OBC'],
        '底盘 CAN': ['GW', 'ESC', 'IBC', 'EPS', 'EPB', 'TPM', 'SRS'],
        '车身 CAN': ['GW', 'BCM', 'PEP', 'DFL', 'DFR', 'DRL', 'DRR', 'SCD', 'SCP', 'HVC', 'LCL', 'LCR', 'RLM', 'PLG', 'WCM'],
        '智驾 CAN': ['GW', 'FCM', 'APA', 'DMS'],
        '信息 CAN': ['GW', 'IVI', 'ICM', 'HUD', 'AMP', 'TBX'],
    },
    'B': {
        '动力 CAN': ['PDC', 'INV', 'BMS', 'OBC'],
        '底盘 CAN': ['CDC', 'ESC', 'IBC', 'EPS', 'SRS'],
        '车身 CAN': ['BDC', 'DFL', 'DFR', 'DRL', 'DRR', 'SCD', 'SCP', 'LCL', 'LCR', 'RLM', 'PLG'],
        '信息 CAN': ['CCU', 'AMP', 'TBX'],
    },
    'C': {
        '前 CAN FD': ['ZFL', 'ESC', 'IBC', 'EPS', 'SRS'],
        '后 CAN FD': ['ZRR', 'INV', 'BMS', 'OBC'],
    },
}
# 以太网：(a, b, 对数)
ETH = {
    'A': [],
    'B': [('GW', 'PDC', 1), ('GW', 'CDC', 1), ('GW', 'BDC', 1), ('GW', 'ADC', 1), ('GW', 'CCU', 1)],
    'C': [('CCC', 'ZFL', 1), ('CCC', 'ZFR', 1), ('ZFL', 'ZRL', 1), ('ZFR', 'ZRR', 1), ('ZRL', 'ZRR', 1)],
}
# 低压配电
PDU = {
    'PF': dict(cn='前配电盒', pos=(350, 1520, 620)),
    'PC': dict(cn='舱内配电盒', pos=(-600, 980, 420)),
}

# 车窗、门锁这类要就近驱动的逻辑，A/B 里在门控，C 里在区控（循环短，放中央没有好处）
_HOST_B = dict(VCU='PDC', TMS='PDC', EPB='CDC', TPM='CDC', BCM='BDC', PEP='BDC', HVC='BDC', WCM='BDC',
               FCM='ADC', APA='ADC', DMS='ADC', IVI='CCU', ICM='CCU', HUD='CCU')
_HOST_C = dict(PDC='CCC', CDC='CCC', BDC='CCC', ADC='CCC', CCU='CCC', AMP='CCC', TBX='CCC', GW='CCC',
               DFL='ZFL', DFR='ZFR', DRL='ZRL', DRR='ZRR', SCD='ZFL', SCP='ZFR',
               LCL='ZFL', LCR='ZFR', RLM='ZRL', PLG='ZRR')


def host_b(h):
    return _HOST_B.get(h, h)


def host_c(h):
    h = host_b(h)
    return _HOST_C.get(h, h)


# ---- 软件功能：逻辑在哪、I/O 在哪
# id, 中文, 域, ASIL, 周期说明, A 架构宿主, C 架构是否把逻辑收到中央
#   ASIL 是 ISO 26262 的安全等级，这里按常见做法估的，具体要看每家的危害分析
_F = [
    ('torque', '扭矩协调', 'pt', 'C', '10 ms', ['VCU'], True),
    ('energy', '能量与续航', 'pt', 'QM', '100 ms', ['VCU'], True),
    ('thermal', '热管理策略', 'pt', 'QM', '1 s', ['TMS'], True),
    ('foc', '电机矢量控制', 'pt', 'D', '100 μs', ['INV'], False),
    ('bms', '电芯保护', 'pt', 'C', '10 ms', ['BMS'], False),
    ('charge', '充电握手', 'pt', 'B', '100 ms', ['OBC'], False),
    ('abs', 'ABS 与稳定控制', 'ch', 'D', '5 ms', ['ESC'], False),
    ('boost', '制动助力', 'ch', 'D', '1 ms', ['IBC'], False),
    ('steer', '转向助力', 'ch', 'D', '1 ms', ['EPS'], False),
    ('blend', '回收与摩擦制动协调', 'ch', 'C', '10 ms', ['VCU', 'ESC'], True),
    ('epb', '电子驻车', 'ch', 'C', '20 ms', ['EPB'], True),
    ('tpms', '胎压告警', 'ch', 'QM', '1 s', ['TPM'], True),
    ('airbag', '碰撞判断与点火', 'ch', 'D', '500 μs', ['SRS'], False),
    ('keyless', '无钥匙进入', 'bd', 'QM', '50 ms', ['PEP'], True),
    ('lock', '门锁逻辑', 'bd', 'A', '20 ms', ['BCM', 'DFL', 'DFR', 'DRL', 'DRR'], True),
    ('window', '车窗防夹', 'bd', 'A', '5 ms', ['DFL', 'DFR', 'DRL', 'DRR'], False),
    ('mirror', '后视镜', 'bd', 'QM', '50 ms', ['DFL', 'DFR'], True),
    ('seat', '座椅记忆', 'bd', 'QM', '50 ms', ['SCD', 'SCP'], True),
    ('light', '灯光逻辑', 'bd', 'B', '20 ms', ['BCM', 'LCL', 'LCR', 'RLM'], True),
    ('wiper', '雨刮', 'bd', 'A', '20 ms', ['WCM'], True),
    ('hvac', '空调策略', 'bd', 'QM', '100 ms', ['HVC'], True),
    ('gate', '电动尾门', 'bd', 'A', '10 ms', ['PLG'], True),
    ('percep', '视觉感知', 'ad', 'B', '33 ms', ['FCM'], True),
    ('aeb', '自动紧急制动', 'ad', 'B', '20 ms', ['FCM'], True),
    ('acc', '车道保持与巡航', 'ad', 'B', '20 ms', ['FCM'], True),
    ('park', '自动泊车', 'ad', 'B', '50 ms', ['APA'], True),
    ('dms', '驾驶员监测', 'ad', 'B', '50 ms', ['DMS'], True),
    ('ui', '中控界面', 'ck', 'QM', '16 ms', ['IVI'], True),
    ('nav', '导航', 'ck', 'QM', '100 ms', ['IVI'], True),
    ('voice', '语音助手', 'ck', 'QM', '50 ms', ['IVI'], True),
    ('cluster', '仪表显示', 'ck', 'B', '16 ms', ['ICM'], True),
    ('hud', '抬头显示', 'ck', 'QM', '16 ms', ['HUD'], True),
    ('audio', '音效', 'ck', 'QM', '5 ms', ['AMP'], True),
    ('remote', '手机 App 与远程', 'ck', 'QM', '1 s', ['TBX'], True),
    ('ota', '升级管理', 'nw', 'QM', '事件', ['GW'], True),
    ('diag', '诊断', 'nw', 'QM', '事件', ['GW'], True),
    ('secgw', '网络安全防护', 'nw', 'QM', '事件', ['GW'], True),
]


def _uniq(seq):
    out = []
    for s in seq:
        if s not in out:
            out.append(s)
    return out


FUNCTIONS = {}
for fid, cn, dom, asil, rate, a_hosts, central in _F:
    b_hosts = _uniq([host_b(h) for h in a_hosts])
    # io：C 架构里逻辑搬走以后，留在原地的 I/O 驱动
    c_all = _uniq([host_c(h) for h in a_hosts])
    if central:
        c_logic = ['CCC']
        c_io = [h for h in c_all if h != 'CCC']
    else:
        c_logic = c_all
        c_io = []
    FUNCTIONS[fid] = dict(cn=cn, dom=dom, asil=asil, rate=rate, hosts=dict(A=a_hosts, B=b_hosts, C=c_logic), io_c=c_io, central=central)

# ---- 外设：传感器和执行器。三种架构里一个都不少，变的只是接到谁
# id, 中文, 类型, 位置, 域, A 宿主, 信号线数, 电源线数(0=无), 线规, C 架构直连谁(None=就近区控)
#   线规: s 细 / m 中 / h 粗 / c 同轴
_P = []


def ep(eid, cn, kind, pos, dom, host, sig, pwr, gauge='m', direct=None, fixed=False):
    _P.append(dict(id=eid, cn=cn, kind=kind, pos=list(pos), dom=dom, hosts=dict(A=host), sig=sig, pwr=pwr, gauge=gauge, direct=direct, fixed=fixed))


def lr(eid, cn, kind, pos, dom, host_l, host_r, sig, pwr, gauge='m', direct=None, fixed=False):
    ep(eid + 'L', '左' + cn, kind, (-pos[0], pos[1], pos[2]), dom, host_l, sig, pwr, gauge, direct, fixed)
    ep(eid + 'R', '右' + cn, kind, (pos[0], pos[1], pos[2]), dom, host_r, sig, pwr, gauge, direct, fixed)


# 感知：摄像头走同轴直连算力
ep('CamF', '前视摄像头', 'camera', (0, 590, 1335), 'ad', 'FCM', 1, 0, 'c', 'CCC')
ep('CamG', '前环视', 'camera', (0, 2300, 560), 'ad', 'APA', 1, 0, 'c', 'CCC')
ep('CamB', '后环视', 'camera', (0, -2345, 900), 'ad', 'APA', 1, 0, 'c', 'CCC')
lr('CamS', '侧环视', 'camera', (960, 980, 1010), 'ad', 'APA', 'APA', 1, 0, 'c', 'CCC')
ep('DmsC', '舱内摄像头', 'camera', (-370, 860, 960), 'ad', 'DMS', 1, 0, 'c', 'CCC')
ep('RadF', '前毫米波雷达', 'radar', (0, 2310, 500), 'ad', 'FCM', 2, 2, 's', 'CCC')
lr('RadR', '后角雷达', 'radar', (770, -2190, 520), 'ad', 'APA', 'APA', 2, 2, 's')
for i, (x, y, z) in enumerate([(-620, 2190, 450), (-220, 2320, 430), (220, 2320, 430), (620, 2190, 450)]):
    ep(f'UsF{i}', f'前超声波 {i + 1}', 'uss', (x, y, z), 'ad', 'APA', 3, 0, 's')
for i, (x, y, z) in enumerate([(-640, -2300, 500), (-220, -2385, 480), (220, -2385, 480), (640, -2300, 500)]):
    ep(f'UsB{i}', f'后超声波 {i + 1}', 'uss', (x, y, z), 'ad', 'APA', 3, 0, 's')
# 灯
lr('Head', '前大灯', 'lamp', (730, 2090, 740), 'bd', 'LCL', 'LCR', 4, 4, 'm')
lr('Tail', '尾灯', 'lamp', (690, -2300, 985), 'bd', 'RLM', 'RLM', 3, 2, 'm')
ep('Horn', '喇叭', 'small', (300, 2200, 520), 'bd', 'BCM', 1, 1, 'm')
ep('IntF', '前阅读灯', 'small', (0, 400, 1380), 'bd', 'BCM', 3, 1, 's')
ep('IntR', '后阅读灯', 'small', (0, -500, 1405), 'bd', 'BCM', 3, 1, 's')
# 门：每扇门 车窗电机 + 门锁 + 把手；前门多一个后视镜
for cn, tag, x, y, h in (('左前', 'FL', -1, 620, 'DFL'), ('右前', 'FR', 1, 620, 'DFR'), ('左后', 'RL', -1, -420, 'DRL'), ('右后', 'RR', 1, -420, 'DRR')):
    ep('Win' + tag, cn + '车窗电机', 'motor', (x * 850, y, 720), 'bd', h, 2, 2, 'h')
    ep('Lck' + tag, cn + '门锁', 'motor', (x * 840, y - (440 if y > 0 else 470), 790), 'bd', h, 3, 2, 'm')
    ep('Hdl' + tag, cn + '门把手', 'small', (x * 930, y - 330 if False else (y - 300), 925), 'bd', h, 3, 1, 's')
lr('Mir', '后视镜', 'motor', (985, 985, 1030), 'bd', 'DFL', 'DFR', 5, 2, 's')
# 座椅
lr('SMt', '前排座椅电机', 'motor', (370, 270, 430), 'bd', 'SCD', 'SCP', 6, 8, 'h')
lr('SHt', '前排座椅加热', 'small', (370, 200, 560), 'bd', 'SCD', 'SCP', 2, 2, 'm')
# 雨刮、空调、前舱
ep('Wip', '雨刮电机', 'motor', (-250, 1290, 900), 'bd', 'WCM', 3, 2, 'h')
ep('Rain', '雨量光线传感器', 'small', (120, 620, 1335), 'bd', 'WCM', 3, 1, 's')
ep('Hood', '前舱盖锁', 'small', (200, 2150, 730), 'bd', 'BCM', 2, 1, 's')
ep('Blw', '鼓风机', 'motor', (300, 1040, 640), 'bd', 'HVC', 3, 2, 'h')
ep('Flp', '风门电机组', 'motor', (-140, 1040, 660), 'bd', 'HVC', 8, 2, 's')
ep('Ptc', 'PTC 加热器', 'small', (120, 1090, 610), 'bd', 'HVC', 3, 2, 'h')
ep('Fan', '冷却风扇', 'motor', (0, 2030, 560), 'pt', 'TMS', 3, 2, 'h')
ep('Pmp', '冷却水泵', 'motor', (-260, 1720, 470), 'pt', 'TMS', 3, 2, 'h')
ep('Cmp', '空调压缩机', 'motor', (260, 1730, 430), 'pt', 'TMS', 3, 0, 'm')
ep('Ped', '踏板传感器', 'small', (-430, 930, 500), 'pt', 'VCU', 6, 0, 's')
ep('Shf', '挡位拨杆', 'small', (-210, 860, 800), 'pt', 'VCU', 4, 1, 's')
ep('HvC', '高压接触器', 'small', (0, -1000, 330), 'pt', 'BMS', 4, 2, 'm', None, True)
ep('ChgP', '充电口', 'small', (-880, -1830, 860), 'pt', 'OBC', 6, 2, 'm', None, True)
# 底盘：闭环短、安全等级高的线不改道
for tag, cn, x, y in (('FL', '左前', -780, 1400), ('FR', '右前', 780, 1400), ('RL', '左后', -780, -1400), ('RR', '右后', 780, -1400)):
    ep('Whl' + tag, cn + '轮速', 'small', (x, y, 345), 'ch', 'ESC', 2, 0, 's', None, True)
lr('Cal', '后驻车卡钳', 'motor', (760, -1430, 280), 'ch', 'EPB', 'EPB', 2, 2, 'h')
ep('SteA', '转角传感器', 'small', (-370, 900, 760), 'ch', 'EPS', 3, 0, 's', None, True)
lr('CrF', '前碰撞传感器', 'small', (640, 2120, 620), 'ch', 'SRS', 'SRS', 2, 0, 's', None, True)
lr('CrS', '侧碰撞传感器', 'small', (830, 40, 620), 'ch', 'SRS', 'SRS', 2, 0, 's', None, True)
lr('BagF', '前排气囊', 'small', (370, 850, 850), 'ch', 'SRS', 'SRS', 2, 0, 's', None, True)
lr('BagC', '侧气帘', 'small', (640, -100, 1350), 'ch', 'SRS', 'SRS', 2, 0, 's', None, True)
lr('Blt', '前排安全带', 'small', (640, -60, 760), 'ch', 'SRS', 'SRS', 2, 0, 's', None, True)
# 座舱
ep('Scr', '中控屏', 'display', (0, 720, 900), 'ck', 'IVI', 1, 2, 'c', 'CCC')
ep('Clu', '仪表屏', 'display', (-370, 850, 905), 'ck', 'ICM', 1, 2, 'c', 'CCC')
ep('Hdp', '抬头显示光机', 'display', (-370, 1040, 900), 'ck', 'HUD', 1, 2, 'c', 'CCC')
ep('Mic', '麦克风', 'small', (0, 300, 1395), 'ck', 'IVI', 3, 0, 's')
ep('SwW', '方向盘按键', 'small', (-370, 720, 800), 'ck', 'BCM', 3, 1, 's')
ep('Ant', '5G/GNSS 天线', 'small', (0, -1720, 1140), 'ck', 'TBX', 2, 0, 'c', 'CCC')
for i, (x, y, z, cn) in enumerate([(-850, 760, 560, '左前门'), (850, 760, 560, '右前门'), (-850, -200, 560, '左后门'), (850, -200, 560, '右后门'), (0, 930, 930, '中置'), (-430, -1560, 1090, '左后搁板'), (430, -1560, 1090, '右后搁板')]):
    ep(f'Spk{i}', cn + '扬声器', 'speaker', (x, y, z), 'ck', 'AMP', 2, 0, 'm')

ENDPOINTS = {}
for p in _P:
    a = p['hosts']['A']
    p['hosts']['B'] = host_b(a)
    if p['fixed']:
        p['hosts']['C'] = a
    elif p['direct']:
        p['hosts']['C'] = p['direct']
    else:
        p['hosts']['C'] = ('ZF' if p['pos'][1] > 0 else 'ZR') + ('L' if p['pos'][0] < 0 else 'R') if p['pos'][0] != 0 else ('ZFL' if p['pos'][1] > 0 else 'ZRR')
    ENDPOINTS[p['id']] = p

# C 架构里这些负载按智能执行器算：一组共用一根低速总线（LIN / 10BASE-T1S / A2B）加一对电源，串起来
SMART = {
    'doorFL': ['MirL', 'WinFL', 'LckFL', 'HdlFL'], 'doorFR': ['MirR', 'WinFR', 'LckFR', 'HdlFR'],
    'doorRL': ['WinRL', 'LckRL', 'HdlRL'], 'doorRR': ['WinRR', 'LckRR', 'HdlRR'],
    'seatD': ['SMtL', 'SHtL'], 'seatP': ['SMtR', 'SHtR'],
    'ussF': ['UsF0', 'UsF1', 'UsF2', 'UsF3'], 'ussB': ['UsB0', 'UsB1', 'UsB2', 'UsB3'],
    'hvac': ['Blw', 'Flp', 'Ptc'], 'audio': ['Spk4', 'Spk0', 'Spk1', 'Spk2', 'Spk3', 'Spk5', 'Spk6'],
}

# ---- 第三章的需求。steps 按信号走向排，keep_hw=False 表示这件事光改软件做不到
FEATURES = [
    dict(id='ui', cn='中控界面改版', tag='座舱内部', asil='QM',
         story='改一版界面布局和动效，不碰任何车辆控制。',
         fns=['ui'], eps=['Scr'], steps=[dict(f='ui', out=['Scr'])], hw=False),
    dict(id='welcome', cn='迎宾模式', tag='跨车身和座舱', asil='QM',
         story='手机靠近解锁：门把手弹出、灯带亮、主驾座椅让位、空调预热、屏幕问好。',
         fns=['keyless', 'lock', 'light', 'seat', 'hvac', 'ui'],
         eps=['HdlFL', 'HeadL', 'HeadR', 'TailL', 'TailR', 'SMtL', 'Blw', 'Scr'],
         steps=[dict(f='keyless', inp=['HdlFL']), dict(f='lock'), dict(f='light', out=['HeadL', 'HeadR', 'TailL', 'TailR']),
                dict(f='seat', out=['SMtL']), dict(f='hvac', out=['Blw']), dict(f='ui', out=['Scr'])], hw=False),
    dict(id='sentry', cn='哨兵模式', tag='跨智驾、车身、动力、通信', asil='B',
         story='停车后摄像头低功耗值守，有人靠近就录像、闪灯，再推送到手机。',
         fns=['percep', 'park', 'energy', 'light', 'remote', 'ui'],
         eps=['CamF', 'CamG', 'CamB', 'CamSL', 'CamSR', 'HeadL', 'HeadR', 'Ant', 'Scr'],
         steps=[dict(f='percep', inp=['CamF', 'CamG', 'CamB', 'CamSL', 'CamSR']), dict(f='energy'), dict(f='light', out=['HeadL', 'HeadR']),
                dict(f='remote', out=['Ant']), dict(f='ui', out=['Scr'])], hw=False),
    dict(id='regen', cn='单踏板回收曲线', tag='动力和制动协调', asil='C',
         story='调整松踏板时的减速度曲线，涉及扭矩请求和摩擦制动的配合。',
         fns=['torque', 'blend', 'abs', 'foc', 'ui'], eps=['Ped', 'Scr'],
         steps=[dict(f='torque', inp=['Ped']), dict(f='blend'), dict(f='abs'), dict(f='foc'), dict(f='ui', out=['Scr'])], hw=False),
    dict(id='abs', cn='ABS 标定优化', tag='制动闭环', asil='D',
         story='重新标定 ABS 算法缩短制动距离。逻辑留在 ESC 里，架构不改变它的宿主。',
         fns=['abs'], eps=['WhlFL', 'WhlFR', 'WhlRL', 'WhlRR'],
         steps=[dict(f='abs', inp=['WhlFL', 'WhlFR', 'WhlRL', 'WhlRR'])], hw=False),
    dict(id='lidar', cn='加一颗激光雷达', tag='新增硬件', asil='B',
         story='感知要一颗车上没有的传感器。软件再灵活也变不出来，已售车装不上。',
         fns=['percep', 'aeb'], eps=['CamF'],
         steps=[dict(f='percep', inp=['CamF']), dict(f='aeb')], hw=True),
]

# ---- 布线：道路图。线只能沿这些路走，这样同一段路上的线才会捆成线束
_N = {}
_L = []


def node(name, x, y, z):
    _N[name] = (x, y, z)


def both(name, x, y, z):
    node(name + 'l', -x, y, z)
    node(name + 'r', x, y, z)


def link(a, b):
    _L.append((a, b))


def link2(a, b):
    link(a + 'l', b + 'l')
    link(a + 'r', b + 'r')


for i, y in enumerate([1050, 450, -100, -650, -1150], 1):
    both(f'S{i}', 770, y, 345)
    node(f'T{i}', 0, y, 345)
    link(f'S{i}l', f'T{i}')
    link(f'S{i}r', f'T{i}')
    if i > 1:
        link2(f'S{i - 1}', f'S{i}')
        link(f'T{i - 1}', f'T{i}')
node('C0', 0, 1120, 720)
both('C1', 400, 1120, 720)
both('C2', 780, 1120, 720)
link('C0', 'C1l'), link('C0', 'C1r')
link2('C1', 'C2')
both('K', 780, 1100, 500)
link2('S1', 'K')
link2('K', 'C2')
link('T1', 'C0')
both('F1', 620, 1260, 650)
both('F2', 620, 1660, 650)
both('F3', 620, 2060, 650)
node('F0', 0, 2110, 650)
node('Fm', 0, 1660, 650)
link2('C2', 'F1')
link2('F1', 'F2')
link2('F2', 'F3')
link('F3l', 'F0'), link('F3r', 'F0')
link('F2l', 'Fm'), link('F2r', 'Fm')
both('A1', 800, 1000, 950)
both('A2', 690, 660, 1235)
both('A3', 610, 420, 1355)
link2('C2', 'A1')
link2('A1', 'A2')
link2('A2', 'A3')
both('R1', 600, 0, 1395)
both('R2', 600, -500, 1385)
both('R3', 600, -900, 1300)
link2('A3', 'R1')
link2('R1', 'R2')
link2('R2', 'R3')
node('Rc', 0, 420, 1375)
link('A3l', 'Rc'), link('A3r', 'Rc')
both('D1', 680, -1300, 1120)
link2('R3', 'D1')
both('H', 480, -1540, 1085)
node('H0', 0, -1540, 1085)
link2('D1', 'H')
link('Hl', 'H0'), link('Hr', 'H0')
both('W1', 720, -1560, 590)
link2('S5', 'W1')
both('B1', 620, -1900, 620)
both('B2', 620, -2220, 730)
node('B0', 0, -2220, 730)
link2('W1', 'B1')
link2('B1', 'B2')
link('B2l', 'B0'), link('B2r', 'B0')
node('L1', 0, -2190, 1040)
link('B0', 'L1')
link('H0', 'L1')
both('P1', 800, 20, 830)        # B 柱
link2('S3', 'P1')
link2('P1', 'R1')
both('DH', 860, 1000, 800)      # 前门铰链
link2('K', 'DH')
both('DM', 860, 640, 640)
link2('DH', 'DM')
both('RH', 860, 10, 760)        # 后门铰链
link2('P1', 'RH')
both('RM', 860, -480, 640)
link2('RH', 'RM')
ROAD_NODES = _N
ROAD_LINKS = _L

# 单根线 kg/m（含绝缘，粗估），和 sig/pwr 配合算线束重量
GAUGE_KG_M = dict(s=.006, m=.012, h=.030, c=.022, can=.011, eth=.014, bb=.120, feed=.018)
