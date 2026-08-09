/**
 * 手机端拍照网页。由本地服务器在 GET / 时返回。
 * 注意：内嵌 JS 全程使用字符串拼接，不用模板字面量，避免与外层 TS 模板字符串冲突。
 * mode: "insert"=插入当前笔记光标处；"newNote"=新建独立笔记。
 */
export function renderCapturePage(opts: {
  token: string;
  maxWidth: number;
  quality: number;
  mode: "insert" | "newNote";
}): string {
  const isInsert = opts.mode === "insert";
  const initialStatus = isInsert
    ? "已就绪。把书本对准摄像头，可连续拍多页；拍完点「识别并插入」，内容会写入电脑端【当前笔记】的当前光标处。"
    : "准备就绪。把书本对准摄像头，可连续拍多页。";
  const sendLabel = isInsert ? "识别并插入" : "识别并生成笔记";
  const rawLabel = isInsert ? "直接插入图片" : "直接存图成笔记";
  // token 是 hex（crypto.randomBytes），可安全内联
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>scan2MD</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f1115;color:#e8e8e8;padding:16px;max-width:680px;margin-left:auto;margin-right:auto}
  h1{font-size:20px;margin:8px 0 4px}
  .status{font-size:14px;color:#9aa0a6;margin:6px 0 12px;min-height:20px;word-break:break-all}
  .title{width:100%;padding:10px 12px;font-size:16px;border-radius:8px;border:1px solid #3a3f47;background:#1b1e24;color:#e8e8e8;margin-bottom:12px}
  #camWrap,#fileWrap{margin-bottom:12px}
  video{width:100%;border-radius:10px;background:#000;display:block}
  .thumb{position:relative;display:inline-block;margin:6px 6px 0 0}
  .thumb img{width:84px;height:84px;object-fit:cover;border-radius:8px}
  .thumb .del{position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;border:0;background:#e53935;color:#fff;font-size:14px;line-height:20px;padding:0}
  button{cursor:pointer;border:0;border-radius:10px;font-size:16px;padding:12px 16px}
  .big{width:100%;font-size:18px;padding:14px}
  #cap{background:#3b82f6;color:#fff;margin-top:8px}
  .alt{display:block;background:#1f2937;color:#e8e8e8;text-align:center}
  .primary{background:#22c55e;color:#06210f}
  .ghost{background:#1b1e24;color:#9aa0a6;border:1px solid #3a3f47;margin-top:8px;width:100%}
  .actions{margin-top:14px}
  #thumbs{min-height:10px}
  .hint{font-size:12px;color:#6b7280;margin-top:6px}
  input[type=file]{display:none}
  .modal{display:none;position:fixed;left:0;right:0;top:0;bottom:0;background:rgba(0,0,0,.88);z-index:10;padding:16px;overflow-y:auto}
  .modal.open{display:block}
  .modal .inner{max-width:680px;margin:0 auto}
  #editCanvas{max-width:100%;border-radius:8px;background:#000;touch-action:none;display:block}
  .editRow{display:flex;gap:8px;margin-top:10px}
  .editRow button{flex:1;padding:10px;font-size:15px}
  .editRow .ghost{margin-top:0;width:auto}
  .sliderRow{display:flex;align-items:center;gap:10px;margin-top:12px;color:#9aa0a6;font-size:14px}
  .sliderRow input[type=range]{flex:1}
  .sliderRow .val{width:44px;text-align:right}
</style>
</head>
<body>
<h1>scan2MD · 拍照转笔记</h1>
<div id="status" class="status">${initialStatus}</div>
<input id="title" class="title" type="text" placeholder="笔记标题（可选，留空用模板）"${
    isInsert ? ' style="display:none"' : ""
  }>
<div id="camWrap">
  <video id="v" autoplay playsinline muted></video>
  <button id="cap" class="big">📸 拍照</button>
</div>
<div id="fileWrap">
  <label class="big alt">📷 从相册 / 拍照选择
    <input id="file" type="file" accept="image/*">
  </label>
</div>
<div id="thumbs"></div>
<div class="hint">点缩略图可编辑图片（旋转 / 明暗 / 对比度 / 裁切）</div>
<div class="actions">
  <button id="send" class="primary big">${sendLabel}</button>
  <button id="sendRaw" class="alt big" style="margin-top:8px">${rawLabel}（不识别）</button>
  <button id="clear" class="ghost">清空已拍</button>
</div>
<div id="editModal" class="modal">
  <div class="inner">
    <div id="editHint" class="status">调整图片后点「保存」；明暗/对比度即时预览。</div>
    <canvas id="editCanvas"></canvas>
    <div class="sliderRow"><span>明暗</span><input id="eBright" type="range" min="30" max="200" value="100"><span id="eBrightV" class="val">100%</span></div>
    <div class="sliderRow"><span>对比度</span><input id="eContrast" type="range" min="30" max="200" value="100"><span id="eContrastV" class="val">100%</span></div>
    <div class="editRow">
      <button id="eRotate" class="alt">↻ 旋转90°</button>
      <button id="eCrop" class="alt">✂ 裁切</button>
    </div>
    <div class="editRow">
      <button id="eSave" class="primary">保存</button>
      <button id="eCancel" class="ghost">取消</button>
    </div>
  </div>
</div>
<script>
var TOKEN = "${opts.token}";
var MAXW = ${opts.maxWidth};
var Q = ${opts.quality};
var MODE = "${opts.mode}";
var SEND_LABEL = "${sendLabel}";
var RAW_LABEL = "${rawLabel}";
var queue = [];
var video = null;
var stream = null;

function $(id){ return document.getElementById(id); }

function setStatus(msg){ $("status").textContent = msg; }

window.addEventListener("DOMContentLoaded", function(){
  video = $("v");
  startCam();
  $("cap").onclick = capture;
  $("file").onchange = function(){ onFile(this); };
  $("send").onclick = function(){ upload(false); };
  $("sendRaw").onclick = function(){ upload(true); };
  $("clear").onclick = function(){ queue = []; renderThumbs(); setStatus("已清空。"); };
  initEditor();
});

async function startCam(){
  // 局域网 http:// 是非安全上下文，多数手机浏览器会禁用 getUserMedia；
  // 此时直接隐藏页面内拍照区，只保留可用的系统相机/相册入口，避免出现"点了没反应"的死按钮。
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    $("camWrap").style.display = "none";
    setStatus("请用下方按钮拍照或从相册选择图片。");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = stream;
    await video.play();
    setStatus("摄像头已就绪，可拍照。");
  } catch (e) {
    $("camWrap").style.display = "none";
    setStatus("无法访问摄像头（" + (e && e.message ? e.message : e) + "）。已切换为系统相机/相册入口，请用下方按钮。");
  }
}

function capture(){
  if (!video || !video.videoWidth){ setStatus("摄像头未就绪，请改用下方按钮选图。"); return; }
  var w = video.videoWidth, h = video.videoHeight;
  if (w > MAXW){ h = Math.round(h * MAXW / w); w = MAXW; }
  var c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(video, 0, 0, w, h);
  push(c.toDataURL("image/jpeg", Q));
}

function onFile(input){
  var f = input.files && input.files[0];
  if (!f) return;
  var r = new FileReader();
  r.onload = function(){ push(r.result); };
  r.readAsDataURL(f);
  input.value = "";
}

function push(dataUrl){
  var b64 = String(dataUrl).split(",")[1];
  queue.push({ b64: b64, dataUrl: dataUrl });
  renderThumbs();
  setStatus("已加入 " + queue.length + " 张，可继续拍或点「" + SEND_LABEL + "」。");
}

function renderThumbs(){
  var box = $("thumbs");
  box.innerHTML = "";
  for (var i = 0; i < queue.length; i++){
    (function(idx){
      var wrap = document.createElement("div");
      wrap.className = "thumb";
      var img = document.createElement("img");
      img.src = queue[idx].dataUrl;
      img.onclick = function(){ openEdit(idx); };
      var del = document.createElement("button");
      del.className = "del";
      del.textContent = "×";
      del.onclick = function(){ queue.splice(idx, 1); renderThumbs(); };
      wrap.appendChild(img);
      wrap.appendChild(del);
      box.appendChild(wrap);
    })(i);
  }
}

/* ---------- 图片编辑器：旋转 / 明暗 / 对比度 / 裁切 ---------- */
var editIdx = -1;
var editBase = null;   // 当前编辑基准（canvas，旋转/裁切会替换它）
var editBright = 100, editContrast = 100;
var cropMode = false, cropStart = null, cropRect = null;
// 老 Safari 的 2d context 不支持 ctx.filter，预览降级、保存时用逐像素算法兜底
var FILTER_OK = (function(){
  var c = document.createElement("canvas").getContext("2d");
  return !!c && typeof c.filter === "string";
})();

function initEditor(){
  $("eRotate").onclick = rotateEdit;
  $("eCrop").onclick = toggleCrop;
  $("eSave").onclick = saveEdit;
  $("eCancel").onclick = closeEdit;
  $("eBright").oninput = function(){ editBright = parseInt(this.value, 10); $("eBrightV").textContent = editBright + "%"; drawEdit(); };
  $("eContrast").oninput = function(){ editContrast = parseInt(this.value, 10); $("eContrastV").textContent = editContrast + "%"; drawEdit(); };
  var ec = $("editCanvas");
  ec.addEventListener("pointerdown", cropDown);
  ec.addEventListener("pointermove", cropMove);
  ec.addEventListener("pointerup", cropUp);
  ec.addEventListener("pointercancel", cropUp);
}

function openEdit(idx){
  editIdx = idx;
  editBright = 100; editContrast = 100;
  cropMode = false; cropStart = null; cropRect = null;
  $("eBright").value = "100"; $("eContrast").value = "100";
  $("eBrightV").textContent = "100%"; $("eContrastV").textContent = "100%";
  $("eCrop").textContent = "✂ 裁切";
  $("editHint").textContent = "调整图片后点「保存」；明暗/对比度即时预览。";
  var img = new Image();
  img.onload = function(){
    var c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    editBase = c;
    drawEdit();
    $("editModal").className = "modal open";
  };
  img.src = queue[idx].dataUrl;
}

function closeEdit(){
  $("editModal").className = "modal";
  editBase = null; editIdx = -1; cropMode = false; cropRect = null;
}

function drawEdit(){
  if (!editBase) return;
  var cv = $("editCanvas"), ctx = cv.getContext("2d");
  cv.width = editBase.width; cv.height = editBase.height;
  if (FILTER_OK) ctx.filter = "brightness(" + editBright + "%) contrast(" + editContrast + "%)";
  ctx.drawImage(editBase, 0, 0);
  if (FILTER_OK) ctx.filter = "none";
  if (cropRect){
    var w = cv.width, h = cv.height;
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.fillRect(0, 0, w, cropRect.y);
    ctx.fillRect(0, cropRect.y + cropRect.h, w, h - cropRect.y - cropRect.h);
    ctx.fillRect(0, cropRect.y, cropRect.x, cropRect.h);
    ctx.fillRect(cropRect.x + cropRect.w, cropRect.y, w - cropRect.x - cropRect.w, cropRect.h);
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = Math.max(2, Math.round(w / 300));
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
    ctx.setLineDash([]);
  }
}

function rotateEdit(){
  if (!editBase) return;
  var c = document.createElement("canvas");
  c.width = editBase.height; c.height = editBase.width;
  var ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(editBase, -editBase.width / 2, -editBase.height / 2);
  editBase = c;
  cropRect = null;
  drawEdit();
}

function toggleCrop(){
  if (!editBase) return;
  if (!cropMode){
    cropMode = true; cropRect = null;
    $("eCrop").textContent = "✓ 应用裁切";
    $("editHint").textContent = "在图片上按住拖动，框选要保留的区域，然后点「✓ 应用裁切」。";
    drawEdit();
  } else {
    if (cropRect && cropRect.w > 10 && cropRect.h > 10){
      var c = document.createElement("canvas");
      c.width = Math.round(cropRect.w); c.height = Math.round(cropRect.h);
      c.getContext("2d").drawImage(
        editBase,
        cropRect.x, cropRect.y, cropRect.w, cropRect.h,
        0, 0, c.width, c.height
      );
      editBase = c;
    }
    cropMode = false; cropRect = null;
    $("eCrop").textContent = "✂ 裁切";
    $("editHint").textContent = "调整图片后点「保存」；明暗/对比度即时预览。";
    drawEdit();
  }
}

function canvasPos(e){
  var cv = $("editCanvas");
  var r = cv.getBoundingClientRect();
  var x = (e.clientX - r.left) * cv.width / r.width;
  var y = (e.clientY - r.top) * cv.height / r.height;
  return {
    x: Math.max(0, Math.min(cv.width, x)),
    y: Math.max(0, Math.min(cv.height, y))
  };
}

function cropDown(e){
  if (!cropMode || !editBase) return;
  e.preventDefault();
  cropStart = canvasPos(e);
  cropRect = null;
  try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
}

function cropMove(e){
  if (!cropMode || !cropStart) return;
  e.preventDefault();
  var p = canvasPos(e);
  cropRect = {
    x: Math.min(cropStart.x, p.x),
    y: Math.min(cropStart.y, p.y),
    w: Math.abs(p.x - cropStart.x),
    h: Math.abs(p.y - cropStart.y)
  };
  drawEdit();
}

function cropUp(){
  cropStart = null;
}

function saveEdit(){
  if (!editBase) { closeEdit(); return; }
  var c = document.createElement("canvas");
  c.width = editBase.width; c.height = editBase.height;
  var ctx = c.getContext("2d");
  ctx.drawImage(editBase, 0, 0);
  if (editBright !== 100 || editContrast !== 100){
    // 逐像素烘焙明暗/对比度，兼容不支持 ctx.filter 的浏览器
    var d = ctx.getImageData(0, 0, c.width, c.height), p = d.data;
    var b = (editBright - 100) * 1.27;          // 30~200% → 约 -89~+127
    var k = editContrast / 100;                  // 对比度系数
    for (var i = 0; i < p.length; i += 4){
      for (var j = 0; j < 3; j++){
        var v = (p[i + j] + b - 128) * k + 128;
        p[i + j] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    ctx.putImageData(d, 0, 0);
  }
  var dataUrl = c.toDataURL("image/jpeg", Q);
  queue[editIdx] = { b64: String(dataUrl).split(",")[1], dataUrl: dataUrl };
  var n = editIdx + 1;
  closeEdit();
  renderThumbs();
  setStatus("已更新第 " + n + " 张图片。");
}
/* ---------- 图片编辑器结束 ---------- */

async function upload(raw){
  if (!queue.length){ setStatus("请先拍摄或选择至少一张图片。"); return; }
  var title = $("title").value.trim();
  var btn = raw ? $("sendRaw") : $("send");
  var otherBtn = raw ? $("send") : $("sendRaw");
  btn.disabled = true;
  otherBtn.disabled = true;
  btn.textContent = raw ? "插入中…" : "识别中…";
  setStatus(raw
    ? "正在上传 " + queue.length + " 张图片（不识别，直接写入）…"
    : "正在上传 " + queue.length + " 张图片并调用模型识别…");
  try {
    var images = [];
    for (var i = 0; i < queue.length; i++) images.push(queue[i].b64);
    var resp = await fetch("/api/upload", {
      method: "POST",
      headers: { "content-type": "application/json", "x-scan-token": TOKEN },
      body: JSON.stringify({ title: title, images: images, raw: !!raw })
    });
    var data = null;
    try { data = await resp.json(); } catch (e) {}
    if (resp.ok && data && data.ok){
      if (data.mode === "insert"){
        setStatus(raw ? "✅ 图片已插入到当前笔记的光标处" : "✅ 已插入到当前笔记的光标处");
      } else {
        setStatus("✅ 已保存：" + (data.path || "笔记"));
      }
      queue = [];
      renderThumbs();
      $("title").value = "";
    } else {
      setStatus("❌ " + ((data && data.error) || ("HTTP " + resp.status)));
    }
  } catch (e) {
    setStatus("❌ 网络错误：" + (e && e.message ? e.message : e));
  } finally {
    btn.disabled = false;
    otherBtn.disabled = false;
    btn.textContent = raw ? (RAW_LABEL + "（不识别）") : SEND_LABEL;
  }
}
</script>
</body>
</html>`;
}
