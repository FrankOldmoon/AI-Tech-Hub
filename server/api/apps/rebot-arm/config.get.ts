/**
 * ReBot Arm B601-RS：机器人配置（从原 server.js /api/config 移植，保留 ROS2/motorbridge 连接配置）。
 */
export default defineEventHandler(() => ({
  name: 'reBot Arm B601-RS',
  robot_variant: 'b601_rs',
  frame: { rosX: 'forward', rosY: 'left', rosZ: 'up', threeMapping: { x: 'ros_x', y: 'ros_z', z: '-ros_y' } },
  reachMeters: 0.56,
  payloadKg: 5,
  gripper: {
    name: 'gripper',
    motorId: '0x07',
    closedMeters: 0,
    openMeters: 0.0715,
    visualOpenMeters: 0.05,
    rosService: '/rebotarm/gripper/set',
    simulationRosService: '/rebotarm_rs/gripper/set'
  },
  motorbridge: {
    defaultUrl: process.env.MOTORBRIDGE_WS_URL || 'ws://127.0.0.1:9002',
    token: process.env.MOTORBRIDGE_WS_TOKEN || '',
    channel: 'can0',
    vendor: 'robstride',
    model: 'rs-00',
    motorIds: [1, 2, 3, 4, 5, 6, 7],
    gripperMotorId: 7,
    gripperOpenMeters: 0.0715
  },
  safety: { hardwareReady: true, note: 'Real hardware uses /rebotarm; the isolated Fake Driver uses /rebotarm_rs.' }
}))
