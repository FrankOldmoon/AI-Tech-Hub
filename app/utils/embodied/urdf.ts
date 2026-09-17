/**
 * URDF 模型定义：从原独立应用 apps/embodied/index.html 逐字提取，未做任何改动。
 * 原来放在 <script type="application/xml"> 里供 DOMParser 解析，这里改为模板字符串。
 */

export const ARM_URDF = `<?xml version="1.0"?>
<robot name="orion_6axis">
  <material name="carbon"><color rgba="0.16 0.18 0.20 1"/></material>
  <material name="plate"><color rgba="0.56 0.63 0.67 1"/></material>
  <material name="cyan"><color rgba="0.0 0.85 0.95 1"/></material>
  <material name="amber"><color rgba="1.0 0.55 0.15 1"/></material>
  <link name="base_link">
    <visual><origin xyz="0 0.03 0"/><geometry><box size="0.52 0.06 0.52"/></geometry><material name="plate"/></visual>
    <visual><origin xyz="0 0.18 0"/><geometry><box size="0.30 0.24 0.30"/></geometry><material name="carbon"/></visual>
    <visual><origin xyz="0 0.32 0"/><geometry><box size="0.16 0.04 0.16"/></geometry><material name="amber"/></visual>
  </link>
  <link name="waist_link"><visual><origin xyz="0 0.09 0"/><geometry><box size="0.12 0.18 0.12"/></geometry><material name="plate"/></visual></link>
  <joint name="base_yaw_joint" type="revolute"><parent link="base_link"/><child link="waist_link"/><origin xyz="0 0.34 0"/><axis xyz="0 1 0"/><limit lower="-3.1" upper="3.1"/></joint>
  <link name="upper_link">
    <visual><origin xyz="0 0.15 0"/><geometry><box size="0.09 0.30 0.09"/></geometry><material name="carbon"/></visual>
    <visual><origin xyz="0 0.32 0"/><geometry><sphere radius="0.052"/></geometry><material name="cyan"/></visual>
  </link>
  <joint name="shoulder_pitch_joint" type="revolute"><parent link="waist_link"/><child link="upper_link"/><origin xyz="0 0.18 0"/><axis xyz="0 0 1"/><limit lower="-1.6" upper="1.6"/></joint>
  <link name="forearm_link"><visual><origin xyz="0 0.12 0"/><geometry><box size="0.075 0.24 0.075"/></geometry><material name="plate"/></visual></link>
  <joint name="elbow_pitch_joint" type="revolute"><parent link="upper_link"/><child link="forearm_link"/><origin xyz="0 0.30 0"/><axis xyz="0 0 1"/><limit lower="-2.0" upper="0.5"/></joint>
  <link name="wrist_link"><visual><origin xyz="0 0.05 0"/><geometry><box size="0.06 0.10 0.06"/></geometry><material name="carbon"/></visual></link>
  <joint name="wrist_pitch_joint" type="revolute"><parent link="forearm_link"/><child link="wrist_link"/><origin xyz="0 0.24 0"/><axis xyz="0 0 1"/><limit lower="-1.4" upper="1.4"/></joint>
  <link name="flange_link"><visual><origin xyz="0 0.02 0"/><geometry><box size="0.10 0.05 0.10"/></geometry><material name="amber"/></visual></link>
  <joint name="wrist_roll_joint" type="revolute"><parent link="wrist_link"/><child link="flange_link"/><origin xyz="0 0.10 0"/><axis xyz="0 1 0"/><limit lower="-2.0" upper="2.0"/></joint>
  <link name="tool_link">
    <visual><origin xyz="0 0.03 -0.045"/><geometry><box size="0.03 0.08 0.03"/></geometry><material name="plate"/></visual>
    <visual><origin xyz="0 0.03 0.045"/><geometry><box size="0.03 0.08 0.03"/></geometry><material name="plate"/></visual>
    <visual><origin xyz="0 0.09 0"/><geometry><sphere radius="0.022"/></geometry><material name="cyan"/></visual>
  </link>
  <joint name="tool_roll_joint" type="revolute"><parent link="flange_link"/><child link="tool_link"/><origin xyz="0 0.05 0"/><axis xyz="0 1 0"/><limit lower="-3.14" upper="3.14"/></joint>
</robot>`

export const QUADRUPED_URDF = `<?xml version="1.0"?>
<robot name="orion_quadruped">
  <material name="carbon"><color rgba="0.16 0.18 0.20 1"/></material>
  <material name="plate"><color rgba="0.56 0.63 0.67 1"/></material>
  <material name="white"><color rgba="0.94 0.97 1.0 1"/></material>
  <material name="cyan"><color rgba="0.0 0.85 0.95 1"/></material>
  <material name="amber"><color rgba="1.0 0.55 0.15 1"/></material>
  <link name="body_link">
    <visual><origin xyz="0 0 0"/><geometry><box size="1.10 0.34 0.16"/></geometry><material name="carbon"/></visual>
    <visual><origin xyz="0 0 -0.088"/><geometry><box size="0.90 0.28 0.012"/></geometry><material name="plate"/></visual>
    <visual><origin xyz="0.30 0 -0.086"/><geometry><box size="0.16 0.03 0.012"/></geometry><material name="cyan"/></visual>
  </link>
  <link name="head_link">
    <visual><origin xyz="0 0 0"/><geometry><box size="0.16 0.11 0.13"/></geometry><material name="white"/></visual>
    <visual><origin xyz="0 0 0.08"/><geometry><sphere radius="0.05"/></geometry><material name="cyan"/></visual>
  </link>
  <joint name="neck_pitch_joint" type="revolute"><parent link="body_link"/><child link="head_link"/><origin xyz="0.55 0 0.055"/><axis xyz="0 1 0"/><limit lower="-0.6" upper="0.6"/></joint>
  <link name="fr_hip_link"><visual><origin xyz="0 0 0"/><geometry><box size="0.07 0.10 0.07"/></geometry><material name="plate"/></visual></link>
  <link name="fr_thigh_link"><visual><origin xyz="0 0 -0.10"/><geometry><box size="0.06 0.06 0.20"/></geometry><material name="plate"/></visual></link>
  <link name="fr_shin_link">
    <visual><origin xyz="0 0 -0.10"/><geometry><box size="0.05 0.05 0.20"/></geometry><material name="carbon"/></visual>
    <visual><origin xyz="0 0 -0.205"/><geometry><box size="0.05 0.09 0.03"/></geometry><material name="cyan"/></visual>
  </link>
  <joint name="fr_hip_abd_joint" type="revolute"><parent link="body_link"/><child link="fr_hip_link"/><origin xyz="0.38 0.20 -0.05"/><axis xyz="1 0 0"/><limit lower="-0.5" upper="0.5"/></joint>
  <joint name="fr_hip_flex_joint" type="revolute"><parent link="fr_hip_link"/><child link="fr_thigh_link"/><origin xyz="0 0 -0.03"/><axis xyz="0 1 0"/><limit lower="-0.8" upper="0.9"/></joint>
  <joint name="fr_knee_joint" type="revolute"><parent link="fr_thigh_link"/><child link="fr_shin_link"/><origin xyz="0 0 -0.18"/><axis xyz="0 1 0"/><limit lower="-1.35" upper="0.08"/></joint>
  <link name="fl_hip_link"><visual><origin xyz="0 0 0"/><geometry><box size="0.07 0.10 0.07"/></geometry><material name="plate"/></visual></link>
  <link name="fl_thigh_link"><visual><origin xyz="0 0 -0.10"/><geometry><box size="0.06 0.06 0.20"/></geometry><material name="plate"/></visual></link>
  <link name="fl_shin_link">
    <visual><origin xyz="0 0 -0.10"/><geometry><box size="0.05 0.05 0.20"/></geometry><material name="carbon"/></visual>
    <visual><origin xyz="0 0 -0.205"/><geometry><box size="0.05 0.09 0.03"/></geometry><material name="cyan"/></visual>
  </link>
  <joint name="fl_hip_abd_joint" type="revolute"><parent link="body_link"/><child link="fl_hip_link"/><origin xyz="0.38 -0.20 -0.05"/><axis xyz="1 0 0"/><limit lower="-0.5" upper="0.5"/></joint>
  <joint name="fl_hip_flex_joint" type="revolute"><parent link="fl_hip_link"/><child link="fl_thigh_link"/><origin xyz="0 0 -0.03"/><axis xyz="0 1 0"/><limit lower="-0.8" upper="0.9"/></joint>
  <joint name="fl_knee_joint" type="revolute"><parent link="fl_thigh_link"/><child link="fl_shin_link"/><origin xyz="0 0 -0.18"/><axis xyz="0 1 0"/><limit lower="-1.35" upper="0.08"/></joint>
  <link name="rr_hip_link"><visual><origin xyz="0 0 0"/><geometry><box size="0.07 0.10 0.07"/></geometry><material name="plate"/></visual></link>
  <link name="rr_thigh_link"><visual><origin xyz="0 0 -0.10"/><geometry><box size="0.06 0.06 0.20"/></geometry><material name="plate"/></visual></link>
  <link name="rr_shin_link">
    <visual><origin xyz="0 0 -0.10"/><geometry><box size="0.05 0.05 0.20"/></geometry><material name="carbon"/></visual>
    <visual><origin xyz="0 0 -0.205"/><geometry><box size="0.05 0.09 0.03"/></geometry><material name="cyan"/></visual>
  </link>
  <joint name="rr_hip_abd_joint" type="revolute"><parent link="body_link"/><child link="rr_hip_link"/><origin xyz="-0.38 0.20 -0.05"/><axis xyz="1 0 0"/><limit lower="-0.5" upper="0.5"/></joint>
  <joint name="rr_hip_flex_joint" type="revolute"><parent link="rr_hip_link"/><child link="rr_thigh_link"/><origin xyz="0 0 -0.03"/><axis xyz="0 1 0"/><limit lower="-0.8" upper="0.9"/></joint>
  <joint name="rr_knee_joint" type="revolute"><parent link="rr_thigh_link"/><child link="rr_shin_link"/><origin xyz="0 0 -0.18"/><axis xyz="0 1 0"/><limit lower="-1.35" upper="0.08"/></joint>
  <link name="rl_hip_link"><visual><origin xyz="0 0 0"/><geometry><box size="0.07 0.10 0.07"/></geometry><material name="plate"/></visual></link>
  <link name="rl_thigh_link"><visual><origin xyz="0 0 -0.10"/><geometry><box size="0.06 0.06 0.20"/></geometry><material name="plate"/></visual></link>
  <link name="rl_shin_link">
    <visual><origin xyz="0 0 -0.10"/><geometry><box size="0.05 0.05 0.20"/></geometry><material name="carbon"/></visual>
    <visual><origin xyz="0 0 -0.205"/><geometry><box size="0.05 0.09 0.03"/></geometry><material name="cyan"/></visual>
  </link>
  <joint name="rl_hip_abd_joint" type="revolute"><parent link="body_link"/><child link="rl_hip_link"/><origin xyz="-0.38 -0.20 -0.05"/><axis xyz="1 0 0"/><limit lower="-0.5" upper="0.5"/></joint>
  <joint name="rl_hip_flex_joint" type="revolute"><parent link="rl_hip_link"/><child link="rl_thigh_link"/><origin xyz="0 0 -0.03"/><axis xyz="0 1 0"/><limit lower="-0.8" upper="0.9"/></joint>
  <joint name="rl_knee_joint" type="revolute"><parent link="rl_thigh_link"/><child link="rl_shin_link"/><origin xyz="0 0 -0.18"/><axis xyz="0 1 0"/><limit lower="-1.35" upper="0.08"/></joint>
</robot>`

export const HUMANOID_URDF = `<?xml version="1.0"?>
<robot name="orion_foundry_v0_1">
  <material name="graphite"><color rgba="0.09 0.137 0.176 1"/></material>
  <material name="mid_metal"><color rgba="0.251 0.318 0.369 1"/></material>
  <material name="armor"><color rgba="0.847 0.878 0.875 1"/></material>
  <material name="armor_dark"><color rgba="0.545 0.604 0.639 1"/></material>
  <material name="cyan"><color rgba="0.125 0.831 0.812 1"/></material>
  <material name="amber"><color rgba="1 0.616 0.18 1"/></material>
  <material name="black"><color rgba="0.027 0.047 0.063 1"/></material>
  <link name="pelvis_link">
    <visual name="pelvis_core"><origin xyz="0 0 0" rpy="0 0 0"/><geometry><box size="0.225 0.145 0.1"/></geometry><material name="graphite"/></visual>
    <visual name="pelvis_front_armor"><origin xyz="0 0.082 0.005" rpy="0 0 0"/><geometry><box size="0.27 0.028 0.082"/></geometry><material name="armor"/></visual>
    <visual name="pelvis_lower_guard"><origin xyz="0 0.07 -0.048" rpy="0 0 0"/><geometry><box size="0.17 0.036 0.052"/></geometry><material name="armor_dark"/></visual>
    <visual name="pelvis_status_light"><origin xyz="0 0.098 0.015" rpy="0 0 0"/><geometry><box size="0.07 0.009 0.015"/></geometry><material name="cyan"/></visual>
  </link>
  <link name="torso_link">
    <visual name="torso_core"><origin xyz="0 0 0.155" rpy="0 0 0"/><geometry><box size="0.255 0.15 0.275"/></geometry><material name="graphite"/></visual>
    <visual name="shoulder_bridge"><origin xyz="0 0 0.275" rpy="0 0 0"/><geometry><box size="0.43 0.145 0.068"/></geometry><material name="mid_metal"/></visual>
    <visual name="chest_armor"><origin xyz="0 0.091 0.19" rpy="0 0 0"/><geometry><box size="0.338 0.031 0.175"/></geometry><material name="armor"/></visual>
    <visual name="abdomen_armor"><origin xyz="0 0.086 0.065" rpy="0 0 0"/><geometry><box size="0.21 0.028 0.082"/></geometry><material name="armor_dark"/></visual>
    <visual name="sternum_light"><origin xyz="0 0.109 0.195" rpy="0 0 0"/><geometry><box size="0.028 0.009 0.11"/></geometry><material name="cyan"/></visual>
  </link>
  <joint name="torso_yaw_joint" type="revolute"><parent link="pelvis_link"/><child link="torso_link"/><origin xyz="0 0 0.07" rpy="0 0 0"/><axis xyz="0 0 1"/><limit lower="-0.34906585" upper="0.34906585"/></joint>
  <link name="neck_link">
    <visual name="neck_post"><origin xyz="0 0 0.026" rpy="0 0 0"/><geometry><cylinder radius="0.031" length="0.052"/></geometry><material name="mid_metal"/></visual>
    <visual name="neck_lower_ring"><origin xyz="0 0 0.008" rpy="0 0 0"/><geometry><cylinder radius="0.047" length="0.015"/></geometry><material name="graphite"/></visual>
    <visual name="neck_upper_ring"><origin xyz="0 0 0.048" rpy="0 0 0"/><geometry><cylinder radius="0.042" length="0.014"/></geometry><material name="cyan"/></visual>
  </link>
  <joint name="neck_yaw_joint" type="revolute"><parent link="torso_link"/><child link="neck_link"/><origin xyz="0 0 0.33" rpy="0 0 0"/><axis xyz="0 0 1"/><limit lower="-1.04719755" upper="1.04719755"/></joint>
  <link name="head_link">
    <visual name="head_shell"><origin xyz="0 0 0.082" rpy="0 0 0"/><geometry><box size="0.158 0.132 0.112"/></geometry><material name="armor"/></visual>
    <visual name="head_face"><origin xyz="0 0.069 0.077" rpy="0 0 0"/><geometry><box size="0.118 0.024 0.065"/></geometry><material name="black"/></visual>
    <visual name="visor_light"><origin xyz="0 0.084 0.09" rpy="0 0 0"/><geometry><box size="0.096 0.008 0.022"/></geometry><material name="cyan"/></visual>
    <visual name="jaw_guard"><origin xyz="0 0.066 0.038" rpy="0 0 0"/><geometry><box size="0.104 0.029 0.031"/></geometry><material name="mid_metal"/></visual>
    <visual name="head_beacon"><origin xyz="0 0 0.166" rpy="0 0 0"/><geometry><sphere radius="0.01"/></geometry><material name="amber"/></visual>
  </link>
  <joint name="head_pitch_joint" type="revolute"><parent link="neck_link"/><child link="head_link"/><origin xyz="0 0 0.055" rpy="0 0 0"/><axis xyz="1 0 0"/><limit lower="-0.523598776" upper="0.610865238"/></joint>
  <link name="left_upper_arm_link">
    <visual name="shoulder_hub"><origin xyz="0 0 0" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.054" length="0.072"/></geometry><material name="graphite"/></visual>
    <visual name="shoulder_trim"><origin xyz="0 0 0" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.043" length="0.078"/></geometry><material name="cyan"/></visual>
    <visual name="upper_arm_frame"><origin xyz="0 0 -0.13" rpy="0 0 0"/><geometry><box size="0.066 0.076 0.205"/></geometry><material name="mid_metal"/></visual>
    <visual name="upper_arm_front_armor"><origin xyz="0 0.049 -0.127" rpy="0 0 0"/><geometry><box size="0.078 0.024 0.156"/></geometry><material name="armor"/></visual>
    <visual name="elbow_pin"><origin xyz="0 0 -0.25" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.042" length="0.07"/></geometry><material name="graphite"/></visual>
  </link>
  <joint name="left_shoulder_joint" type="revolute"><parent link="torso_link"/><child link="left_upper_arm_link"/><origin xyz="-0.24 0 0.29" rpy="0 0 0"/><axis xyz="1 0 0"/><limit lower="-1.91986218" upper="1.91986218"/></joint>
  <link name="left_forearm_link">
    <visual name="elbow_cap"><origin xyz="0 0 0" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.045" length="0.078"/></geometry><material name="mid_metal"/></visual>
    <visual name="forearm_frame"><origin xyz="0 0 -0.105" rpy="0 0 0"/><geometry><box size="0.062 0.074 0.177"/></geometry><material name="graphite"/></visual>
    <visual name="forearm_front_armor"><origin xyz="0 0.048 -0.11" rpy="0 0 0"/><geometry><box size="0.086 0.029 0.156"/></geometry><material name="armor"/></visual>
    <visual name="wrist_socket"><origin xyz="0 0 -0.225" rpy="0 0 0"/><geometry><cylinder radius="0.035" length="0.062"/></geometry><material name="mid_metal"/></visual>
  </link>
  <joint name="left_elbow_joint" type="revolute"><parent link="left_upper_arm_link"/><child link="left_forearm_link"/><origin xyz="0 0 -0.25" rpy="0 0 0"/><axis xyz="1 0 0"/><limit lower="0" upper="2.35619449"/></joint>
  <link name="left_hand_link">
    <visual name="wrist_bearing"><origin xyz="0 0 -0.01" rpy="0 0 0"/><geometry><cylinder radius="0.034" length="0.03"/></geometry><material name="graphite"/></visual>
    <visual name="palm_frame"><origin xyz="0 0 -0.07" rpy="0 0 0"/><geometry><box size="0.086 0.066 0.098"/></geometry><material name="mid_metal"/></visual>
    <visual name="palm_armor"><origin xyz="0 0.041 -0.071" rpy="0 0 0"/><geometry><box size="0.072 0.019 0.072"/></geometry><material name="armor"/></visual>
    <visual name="finger_1"><origin xyz="-0.027 0.002 -0.143" rpy="0 0 0"/><geometry><box size="0.018 0.026 0.055"/></geometry><material name="graphite"/></visual>
    <visual name="finger_2"><origin xyz="0 0.002 -0.143" rpy="0 0 0"/><geometry><box size="0.018 0.026 0.055"/></geometry><material name="graphite"/></visual>
    <visual name="finger_3"><origin xyz="0.027 0.002 -0.143" rpy="0 0 0"/><geometry><box size="0.018 0.026 0.055"/></geometry><material name="graphite"/></visual>
  </link>
  <joint name="left_wrist_joint" type="revolute"><parent link="left_forearm_link"/><child link="left_hand_link"/><origin xyz="0 0 -0.225" rpy="0 0 0"/><axis xyz="0 0 1"/><limit lower="-1.57079633" upper="1.57079633"/></joint>
  <link name="left_thigh_link">
    <visual name="hip_rotor"><origin xyz="0 0 0" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.052" length="0.076"/></geometry><material name="graphite"/></visual>
    <visual name="thigh_frame"><origin xyz="0 0 -0.139" rpy="0 0 0"/><geometry><box size="0.091 0.103 0.232"/></geometry><material name="mid_metal"/></visual>
    <visual name="thigh_front_armor"><origin xyz="0 0.065 -0.135" rpy="0 0 0"/><geometry><box size="0.112 0.031 0.202"/></geometry><material name="armor"/></visual>
    <visual name="knee_axle"><origin xyz="0 0 -0.285" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.048" length="0.088"/></geometry><material name="graphite"/></visual>
  </link>
  <joint name="left_hip_joint" type="revolute"><parent link="pelvis_link"/><child link="left_thigh_link"/><origin xyz="-0.105 0 -0.05" rpy="0 0 0"/><axis xyz="1 0 0"/><limit lower="-0.959931089" upper="1.30899694"/></joint>
  <link name="left_shin_link">
    <visual name="knee_guard"><origin xyz="0 0 0" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.051" length="0.092"/></geometry><material name="mid_metal"/></visual>
    <visual name="shin_frame"><origin xyz="0 0 -0.135" rpy="0 0 0"/><geometry><box size="0.082 0.091 0.22"/></geometry><material name="graphite"/></visual>
    <visual name="shin_front_armor"><origin xyz="0 0.06 -0.127" rpy="0 0 0"/><geometry><box size="0.108 0.035 0.191"/></geometry><material name="armor"/></visual>
    <visual name="calf_armor"><origin xyz="0 -0.057 -0.141" rpy="0 0 0"/><geometry><box size="0.087 0.029 0.148"/></geometry><material name="armor_dark"/></visual>
    <visual name="ankle_socket"><origin xyz="0 0 -0.275" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.038" length="0.073"/></geometry><material name="mid_metal"/></visual>
  </link>
  <joint name="left_knee_joint" type="revolute"><parent link="left_thigh_link"/><child link="left_shin_link"/><origin xyz="0 0 -0.285" rpy="0 0 0"/><axis xyz="-1 0 0"/><limit lower="0" upper="2.18166156"/></joint>
  <link name="left_foot_link">
    <visual name="ankle_ball"><origin xyz="0 0 0" rpy="0 0 0"/><geometry><sphere radius="0.039"/></geometry><material name="graphite"/></visual>
    <visual name="foot_frame"><origin xyz="0 0.038 -0.066" rpy="0 0 0"/><geometry><box size="0.118 0.21 0.072"/></geometry><material name="mid_metal"/></visual>
    <visual name="foot_top_armor"><origin xyz="0 0.052 -0.023" rpy="0 0 0"/><geometry><box size="0.111 0.145 0.029"/></geometry><material name="armor"/></visual>
    <visual name="toe_bumper"><origin xyz="0 0.113 -0.067" rpy="0 0 0"/><geometry><box size="0.122 0.076 0.049"/></geometry><material name="armor_dark"/></visual>
    <visual name="heel_block"><origin xyz="0 -0.076 -0.065" rpy="0 0 0"/><geometry><box size="0.105 0.065 0.064"/></geometry><material name="graphite"/></visual>
  </link>
  <joint name="left_ankle_joint" type="revolute"><parent link="left_shin_link"/><child link="left_foot_link"/><origin xyz="0 0 -0.275" rpy="0 0 0"/><axis xyz="1 0 0"/><limit lower="-0.610865238" upper="0.610865238"/></joint>
  <link name="right_upper_arm_link">
    <visual name="shoulder_hub"><origin xyz="0 0 0" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.054" length="0.072"/></geometry><material name="graphite"/></visual>
    <visual name="shoulder_trim"><origin xyz="0 0 0" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.043" length="0.078"/></geometry><material name="cyan"/></visual>
    <visual name="upper_arm_frame"><origin xyz="0 0 -0.13" rpy="0 0 0"/><geometry><box size="0.066 0.076 0.205"/></geometry><material name="mid_metal"/></visual>
    <visual name="upper_arm_front_armor"><origin xyz="0 0.049 -0.127" rpy="0 0 0"/><geometry><box size="0.078 0.024 0.156"/></geometry><material name="armor"/></visual>
    <visual name="elbow_pin"><origin xyz="0 0 -0.25" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.042" length="0.07"/></geometry><material name="graphite"/></visual>
  </link>
  <joint name="right_shoulder_joint" type="revolute"><parent link="torso_link"/><child link="right_upper_arm_link"/><origin xyz="0.24 0 0.29" rpy="0 0 0"/><axis xyz="1 0 0"/><limit lower="-1.91986218" upper="1.91986218"/></joint>
  <link name="right_forearm_link">
    <visual name="elbow_cap"><origin xyz="0 0 0" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.045" length="0.078"/></geometry><material name="mid_metal"/></visual>
    <visual name="forearm_frame"><origin xyz="0 0 -0.105" rpy="0 0 0"/><geometry><box size="0.062 0.074 0.177"/></geometry><material name="graphite"/></visual>
    <visual name="forearm_front_armor"><origin xyz="0 0.048 -0.11" rpy="0 0 0"/><geometry><box size="0.086 0.029 0.156"/></geometry><material name="armor"/></visual>
    <visual name="wrist_socket"><origin xyz="0 0 -0.225" rpy="0 0 0"/><geometry><cylinder radius="0.035" length="0.062"/></geometry><material name="mid_metal"/></visual>
  </link>
  <joint name="right_elbow_joint" type="revolute"><parent link="right_upper_arm_link"/><child link="right_forearm_link"/><origin xyz="0 0 -0.25" rpy="0 0 0"/><axis xyz="1 0 0"/><limit lower="0" upper="2.35619449"/></joint>
  <link name="right_hand_link">
    <visual name="wrist_bearing"><origin xyz="0 0 -0.01" rpy="0 0 0"/><geometry><cylinder radius="0.034" length="0.03"/></geometry><material name="graphite"/></visual>
    <visual name="palm_frame"><origin xyz="0 0 -0.07" rpy="0 0 0"/><geometry><box size="0.086 0.066 0.098"/></geometry><material name="mid_metal"/></visual>
    <visual name="palm_armor"><origin xyz="0 0.041 -0.071" rpy="0 0 0"/><geometry><box size="0.072 0.019 0.072"/></geometry><material name="armor"/></visual>
    <visual name="finger_1"><origin xyz="-0.027 0.002 -0.143" rpy="0 0 0"/><geometry><box size="0.018 0.026 0.055"/></geometry><material name="graphite"/></visual>
    <visual name="finger_2"><origin xyz="0 0.002 -0.143" rpy="0 0 0"/><geometry><box size="0.018 0.026 0.055"/></geometry><material name="graphite"/></visual>
    <visual name="finger_3"><origin xyz="0.027 0.002 -0.143" rpy="0 0 0"/><geometry><box size="0.018 0.026 0.055"/></geometry><material name="graphite"/></visual>
  </link>
  <joint name="right_wrist_joint" type="revolute"><parent link="right_forearm_link"/><child link="right_hand_link"/><origin xyz="0 0 -0.225" rpy="0 0 0"/><axis xyz="0 0 1"/><limit lower="-1.57079633" upper="1.57079633"/></joint>
  <link name="right_thigh_link">
    <visual name="hip_rotor"><origin xyz="0 0 0" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.052" length="0.076"/></geometry><material name="graphite"/></visual>
    <visual name="thigh_frame"><origin xyz="0 0 -0.139" rpy="0 0 0"/><geometry><box size="0.091 0.103 0.232"/></geometry><material name="mid_metal"/></visual>
    <visual name="thigh_front_armor"><origin xyz="0 0.065 -0.135" rpy="0 0 0"/><geometry><box size="0.112 0.031 0.202"/></geometry><material name="armor"/></visual>
    <visual name="knee_axle"><origin xyz="0 0 -0.285" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.048" length="0.088"/></geometry><material name="graphite"/></visual>
  </link>
  <joint name="right_hip_joint" type="revolute"><parent link="pelvis_link"/><child link="right_thigh_link"/><origin xyz="0.105 0 -0.05" rpy="0 0 0"/><axis xyz="1 0 0"/><limit lower="-0.959931089" upper="1.30899694"/></joint>
  <link name="right_shin_link">
    <visual name="knee_guard"><origin xyz="0 0 0" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.051" length="0.092"/></geometry><material name="mid_metal"/></visual>
    <visual name="shin_frame"><origin xyz="0 0 -0.135" rpy="0 0 0"/><geometry><box size="0.082 0.091 0.22"/></geometry><material name="graphite"/></visual>
    <visual name="shin_front_armor"><origin xyz="0 0.06 -0.127" rpy="0 0 0"/><geometry><box size="0.108 0.035 0.191"/></geometry><material name="armor"/></visual>
    <visual name="calf_armor"><origin xyz="0 -0.057 -0.141" rpy="0 0 0"/><geometry><box size="0.087 0.029 0.148"/></geometry><material name="armor_dark"/></visual>
    <visual name="ankle_socket"><origin xyz="0 0 -0.275" rpy="0 1.57079633 0"/><geometry><cylinder radius="0.038" length="0.073"/></geometry><material name="mid_metal"/></visual>
  </link>
  <joint name="right_knee_joint" type="revolute"><parent link="right_thigh_link"/><child link="right_shin_link"/><origin xyz="0 0 -0.285" rpy="0 0 0"/><axis xyz="-1 0 0"/><limit lower="0" upper="2.18166156"/></joint>
  <link name="right_foot_link">
    <visual name="ankle_ball"><origin xyz="0 0 0" rpy="0 0 0"/><geometry><sphere radius="0.039"/></geometry><material name="graphite"/></visual>
    <visual name="foot_frame"><origin xyz="0 0.038 -0.066" rpy="0 0 0"/><geometry><box size="0.118 0.21 0.072"/></geometry><material name="mid_metal"/></visual>
    <visual name="foot_top_armor"><origin xyz="0 0.052 -0.023" rpy="0 0 0"/><geometry><box size="0.111 0.145 0.029"/></geometry><material name="armor"/></visual>
    <visual name="toe_bumper"><origin xyz="0 0.113 -0.067" rpy="0 0 0"/><geometry><box size="0.122 0.076 0.049"/></geometry><material name="armor_dark"/></visual>
    <visual name="heel_block"><origin xyz="0 -0.076 -0.065" rpy="0 0 0"/><geometry><box size="0.105 0.065 0.064"/></geometry><material name="graphite"/></visual>
  </link>
  <joint name="right_ankle_joint" type="revolute"><parent link="right_shin_link"/><child link="right_foot_link"/><origin xyz="0 0 -0.275" rpy="0 0 0"/><axis xyz="1 0 0"/><limit lower="-0.610865238" upper="0.610865238"/></joint>
</robot>`
