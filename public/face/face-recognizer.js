/**
 * Student face recognition — browser helper
 *
 * Requires: face-api.js loaded in the browser (CDN or bundled, exposed as window.faceapi)
 * Data: students-face-data.json in the same folder (pre-computed 128-d descriptors + student info)
 *
 * Typical usage:
 *   const rec = await createFaceRecognizer({ faceapi: window.faceapi, modelUrl: './models' });
 *   await rec.load();                          // 加载学生特征库（模型随构造自动加载）
 *   const r = await rec.match(videoEl);        // 传入 video / canvas / img
 *   if (r.matched) console.log(r.student.class, r.student.chineseName, r.student.preferredName);
 */
(function (root) {
  'use strict';

  const DATA_URL = new URL('students-face-data.json', document.currentScript
    ? document.currentScript.src
    : location.href).href;

  function euclidean(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  }

  async function createFaceRecognizer(options) {
    const opts = Object.assign({
      faceapi: root.faceapi,                 // 必须：face-api.js 命名空间
      dataUrl: DATA_URL,                     // 学生特征库地址
      modelUrl: '/models',                   // face-api 模型目录
      threshold: null,                       // 判定阈值；null = 用 JSON 里的推荐值
      inputSize: 416,                        // TinyFaceDetector 输入尺寸（检测速度/精度权衡）
      scoreThreshold: 0.35,                  // 检测置信度门槛
      detector: 'ssdMobilenetv1',            // 'ssdMobilenetv1' | 'tinyFaceDetector'
      topK: 3,                               // 每次比对返回的候选数
      requireMargin: 0,                      // >0 时要求第一名与第二名的最小距离间隔（跨域场景建议 0.05）
      autoLoadModels: true,                  // 构造时自动加载 face-api 模型
      autoLoad: true,                        // 构造时自动加载学生特征库
      debug: true,
    }, options || {});

    if (!opts.faceapi) throw new Error('[face-recognizer] 缺少 faceapi：face-api.js must be loaded first');
    const fa = opts.faceapi;
    const log = (...a) => { if (opts.debug) console.log('[face-recognizer]', ...a); };

    const state = {
      meta: null,
      students: [],          // 原始记录
      byLabel: new Map(),    // label -> 学生记录
      descriptors: [],       // [{ label, vec: Float32Array }]
      labeled: null,         // faceapi.LabeledFaceDescriptors[]
      faceMatcher: null,
      threshold: 0.5,
      modelsLoaded: false,
      loaded: false,
      ssdLoaded: false,
      tinyLoaded: false,
      enrollment: null,
    };

    // ---------------- 模型 ----------------
    /** 确保指定检测器已加载。两个检测器互斥使用，另一个留到真要切换时再拉。 */
    async function ensureDetector(name, base) {
      if (name === 'tinyFaceDetector') {
        if (!state.tinyLoaded) {
          await fa.nets.tinyFaceDetector.loadFromUri(base);
          state.tinyLoaded = true;
        }
        return;
      }
      if (!state.ssdLoaded) {
        await fa.nets.ssdMobilenetv1.loadFromUri(base);
        state.ssdLoaded = true;
      }
    }

    async function loadModels(modelUrl) {
      const base = modelUrl || opts.modelUrl;
      // 只加载当前选中的检测器 + 识别链必需的关键点/特征描述两个模型。
      await Promise.all([
        ensureDetector(opts.detector, base),
        fa.nets.faceLandmark68Net.loadFromUri(base),
        fa.nets.faceRecognitionNet.loadFromUri(base),
      ]);
      state.modelsLoaded = true;
      log('models loaded from', base, '· detector =', opts.detector);
    }

    /**
     * 运行时切换检测器（'ssdMobilenetv1' 准但慢｜'tinyFaceDetector' 快但小脸易漏）。
     * 换过去时才真正加载对应模型，供真机上做速度/精度取舍的 A/B。
     */
    async function setDetector(name) {
      if (name !== 'ssdMobilenetv1' && name !== 'tinyFaceDetector') {
        throw new Error('[face-recognizer] unknown detector: ' + name);
      }
      await ensureDetector(name, opts.modelUrl);
      opts.detector = name;
      log('detector set to', name);
    }

    // ---------------- 特征库 ----------------
    async function load(dataUrl) {
      const data = await fetch(dataUrl || opts.dataUrl).then((r) => r.json());
      state.meta = data.meta;
      state.students = data.records;
      state.threshold = opts.threshold ?? data.meta.suggestedMatchThreshold ?? 0.4;

      state.byLabel = new Map();
      state.descriptors = [];
      for (const rec of state.students) {
        state.byLabel.set(rec.label, rec);
        for (const d of rec.descriptors) {
          state.descriptors.push({ label: rec.label, vec: Float32Array.from(d) });
        }
      }
      state.labeled = state.students.map(
        (rec) => new fa.LabeledFaceDescriptors(rec.label, rec.descriptors.map((d) => Float32Array.from(d)))
      );
      state.faceMatcher = new fa.FaceMatcher(state.labeled, state.threshold);

      // 按班级索引
      state.enrollment = {};
      for (const rec of state.students) {
        (state.enrollment[rec.class] = state.enrollment[rec.class] || []).push(rec);
      }
      state.loaded = true;
      log(`gallery ready: ${state.students.length} of ${state.meta.totalStudentsInCsv} enrolled students, threshold ${state.threshold}`);
      if (state.meta.calibration) log('calibrated: same-person max', state.meta.calibration.genuineDistance.max, '/ different-person min', state.meta.calibration.impostorDistance.min);
      return data;
    }

    // ---------------- 检测 ----------------
    function detectorOptions() {
      return opts.detector === 'tinyFaceDetector'
        ? new fa.TinyFaceDetectorOptions({ inputSize: opts.inputSize, scoreThreshold: opts.scoreThreshold })
        : new fa.SsdMobilenetv1Options({ minConfidence: opts.scoreThreshold });
    }

    /** 从 video / canvas / img / ImageData 提取所有人脸特征 */
    async function detectAll(input) {
      const results = await fa
        .detectAllFaces(input, detectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptors();
      return results.map((r) => ({
        box: { x: r.detection.box.x, y: r.detection.box.y, width: r.detection.box.width, height: r.detection.box.height },
        score: r.detection.score,
        descriptor: r.descriptor,
      }));
    }

    /** 与特征库比对：返回 Top-N 候选 + 判定结果 */
    function identify(descriptor, topN) {
      const n = topN || opts.topK || 3;
      const ranked = [];
      for (const item of state.descriptors) {
        ranked.push({ label: item.label, distance: euclidean(descriptor, item.vec) });
      }
      ranked.sort((a, b) => a.distance - b.distance);
      const top = ranked.slice(0, n).map((c) => ({
        label: c.label,
        distance: c.distance,
        student: state.byLabel.get(c.label),
      }));
      if (!top.length) return { matched: false, label: 'unknown', distance: Infinity, student: null, candidates: [] };

      const best = top[0];
      // 可选：第二候选的置信间隔（cross-domain 场景下能显著压低误识）
      const margin = top[1] ? top[1].distance - best.distance : Infinity;
      const matched =
        best.distance <= state.threshold &&
        (!opts.requireMargin || margin >= opts.requireMargin);

      return {
        matched,
        label: matched ? best.label : 'unknown',
        distance: best.distance,
        margin,
        student: matched ? best.student : null,
        /** 未过阈值时也可用于人工复核 */
        nearest: best.student,
        candidates: top,
      };
    }

    /** 单脸识别：适合打卡/签到场景 */
    async function match(input) {
      const faces = await detectAll(input);
      if (!faces.length) return { matched: false, faces: [], reason: 'no-face' };
      // 取面积最大的人脸
      const main = faces.reduce((a, b) => (a.box.width * a.box.height >= b.box.width * b.box.height ? a : b));
      const result = identify(main.descriptor);
      return Object.assign({ faces: faces.map((f) => ({ box: f.box, score: f.score })) }, result);
    }

    /** 多脸识别：适合课堂点名 */
    async function matchAll(input) {
      const faces = await detectAll(input);
      return faces.map((f) => Object.assign({ box: f.box, score: f.score }, identify(f.descriptor)));
    }

    /** 用 face-api 原生 FaceMatcher 比对（对照组/兼容用） */
    function matchWithFaceMatcher(descriptor) {
      if (!state.faceMatcher) throw new Error('[face-recognizer] call load() first');
      const best = state.faceMatcher.findBestMatch(descriptor);
      return {
        matched: best.label !== 'unknown',
        label: best.label,
        distance: best.distance,
        student: best.label !== 'unknown' ? state.byLabel.get(best.label) : null,
      };
    }

    /** 取学生展示信息（前端 label 渲染常用） */
    function display(rec) {
      if (!rec) return '';
      return `${rec.class} ${rec.chineseName}${rec.preferredName ? ' / ' + rec.preferredName : ''} (${rec.studentNo})`;
    }

    /**
     * 粗略基准：把「检测 → 关键点 → 特征描述」三段分开计时。
     * 做法是跑三条长度递增的链、用相邻差值推每段耗时（face-api 的链式 API 只能整链 await）。
     * rounds 越大越准；每轮要跑 3 次完整链路，别设太大。
     */
    async function benchmark(input, rounds) {
      const n = Math.max(1, rounds || 3);
      const options = detectorOptions();
      let detect = 0, landmarks = 0, descriptor = 0;
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        await fa.detectAllFaces(input, options);
        const t1 = performance.now();
        await fa.detectAllFaces(input, options).withFaceLandmarks();
        const t2 = performance.now();
        await fa.detectAllFaces(input, options).withFaceLandmarks().withFaceDescriptors();
        const t3 = performance.now();
        detect += t1 - t0;
        landmarks += t2 - t1;
        descriptor += t3 - t2;
      }
      return {
        detector: opts.detector,
        inputSize: opts.detector === 'tinyFaceDetector' ? opts.inputSize : 512,
        rounds: n,
        detectMs: detect / n,
        landmarksMs: landmarks / n,
        descriptorMs: descriptor / n,
        totalMs: (detect + landmarks + descriptor) / n,
      };
    }

    function setThreshold(t) { state.threshold = t; if (state.faceMatcher) state.faceMatcher = new fa.FaceMatcher(state.labeled, t); log('threshold set to', t); }

    if (opts.autoLoadModels) await loadModels();
    if (opts.autoLoad) await load();
    return {
      load, loadModels, match, matchAll, detectAll, identify, matchWithFaceMatcher,
      display, setThreshold, setDetector, benchmark,
      get students() { return state.students; },
      get enrollment() { return state.enrollment; },
      get meta() { return state.meta; },
      get state() { return state; },
    };
  }

  root.createFaceRecognizer = createFaceRecognizer;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createFaceRecognizer };
})(typeof self !== 'undefined' ? self : this);
