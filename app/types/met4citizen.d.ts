/* eslint-disable @typescript-eslint/no-explicit-any -- 第三方库没有类型声明，这里只做「模块存在」的最小声明 */
/* 第三方运行时库没有自带类型声明（只有 ESM 产物），这里给最小声明，避免
   TS 解析不到模块时报错。真正的形状见各自仓库的 README。 */
declare module '@met4citizen/talkinghead' {
  /** 3D 说话头像：渲染、口型混合、音频播放 */
  export const TalkingHead: any
}
