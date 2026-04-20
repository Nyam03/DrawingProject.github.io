import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// --- 1. Firebase 설정 ---
const firebaseConfig = {
  apiKey: "AIzaSyAje85hdqJ9iEZuvL57ZYL2HJa8vUZcGBc",
  authDomain: "drawingproject-ae35d.firebaseapp.com",
  projectId: "drawingproject-ae35d",
  storageBucket: "drawingproject-ae35d.firebasestorage.app",
  messagingSenderId: "224466239154",
  appId: "1:224466239154:web:951dd5a55526c8edfa53ab"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- 2. 상태 관리 ---
const roomId = "room1";
let currentLayer = "layer1";
let tool = "brush", color = "#000000", size = 5;
let layers = []; 
let canvases = {}, contexts = {};
let scale = 1, offset = { x: 0, y: 0 };
let drawing = false, currentStroke = [];

// --- 3. 레이어 관리 함수 ---
function createLayer(layerId) {
  const container = document.getElementById("canvasContainer");
  const canvas = document.createElement("canvas");
  
  canvas.width = 1920; 
  canvas.height = 1080;
  canvas.classList.add("layerCanvas");
  canvas.id = `canvas-${layerId}`;
  container.appendChild(canvas);

  canvases[layerId] = canvas;
  contexts[layerId] = canvas.getContext("2d");

  const newLayer = { id: layerId, order: layers.length, opacity: 1 };
  layers.push(newLayer);
  
  listenLayer(layerId);
  updateLayerUI();
}

function updateLayerUI() {
  const list = document.getElementById("layersList");
  list.innerHTML = "";

  [...layers].sort((a, b) => b.order - a.order).forEach((layer) => {
    const div = document.createElement("div");
    div.className = `layerItem ${currentLayer === layer.id ? "active" : ""}`;
    div.innerHTML = `
      <div class="layer-top">
        <span>${layer.id}</span>
        <div class="layer-controls">
          <button class="small-btn up-btn">▲</button>
          <button class="small-btn down-btn">▼</button>
          <button class="small-btn del-btn">✕</button>
        </div>
      </div>
      <input type="range" min="0" max="1" step="0.1" value="${layer.opacity}">
    `;

    div.onclick = () => { currentLayer = layer.id; updateLayerUI(); };
    div.querySelector(".up-btn").onclick = (e) => { e.stopPropagation(); moveLayer(layer.id, 1); };
    div.querySelector(".down-btn").onclick = (e) => { e.stopPropagation(); moveLayer(layer.id, -1); };
    div.querySelector(".del-btn").onclick = (e) => { 
      e.stopPropagation(); 
      if(layers.length > 1) removeLayer(layer.id);
    };
    div.querySelector("input").oninput = (e) => {
      layer.opacity = e.target.value;
      canvases[layer.id].style.opacity = layer.opacity;
    };
    list.appendChild(div);
  });
}

function moveLayer(id, direction) {
  const idx = layers.findIndex(l => l.id === id);
  const targetIdx = idx + direction;
  if (targetIdx >= 0 && targetIdx < layers.length) {
    [layers[idx].order, layers[targetIdx].order] = [layers[targetIdx].order, layers[idx].order];
    canvases[layers[idx].id].style.zIndex = layers[idx].order;
    canvases[layers[targetIdx].id].style.zIndex = layers[targetIdx].order;
    updateLayerUI();
  }
}

async function removeLayer(id) {
  if (!confirm(`${id}를 삭제하시겠습니까?`)) return;
  canvases[id].remove();
  delete canvases[id];
  delete contexts[id];
  layers = layers.filter(l => l.id !== id);
  if (currentLayer === id) currentLayer = layers[0].id;
  updateLayerUI();
}

// --- 4. 드로잉 및 좌표 계산 ---
function getMousePos(e) {
  const rect = canvases[currentLayer].getBoundingClientRect();
  const scaleX = canvases[currentLayer].width / rect.width;
  const scaleY = canvases[currentLayer].height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function drawSegment(ctx, points) {
  if (points.length < 2) return;
  const p1 = points[points.length - 2], p2 = points[points.length - 1];
  ctx.lineWidth = size;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
}

// --- 5. Firebase 데이터 동기화 ---
function listenLayer(layerId) {
  const ref = collection(db, "rooms", roomId, "pages", "page1", "layers", layerId, "strokes");
  onSnapshot(query(ref, orderBy("timestamp")), (snap) => {
    const ctx = contexts[layerId];
    if (!ctx) return;
    ctx.clearRect(0, 0, 1920, 1080);
    snap.forEach(doc => {
      const s = doc.data();
      ctx.lineWidth = s.size;
      ctx.strokeStyle = s.color;
      ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
      ctx.beginPath();
      s.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
    });
  });
}

// --- 6. Ctrl + Z (Undo) 기능 ---
async function undoLastStroke() {
  const ref = collection(db, "rooms", roomId, "pages", "page1", "layers", currentLayer, "strokes");
  // 가장 최근 생성된 문서 1개 가져오기
  const q = query(ref, orderBy("timestamp", "desc"), limit(1));
  const querySnapshot = await getDocs(q);
  
  querySnapshot.forEach(async (document) => {
    await deleteDoc(doc(db, ref.path, document.id));
  });
}

// --- 7. 이벤트 리스너 설정 ---

// 그리기 시작/종료
document.addEventListener("mousedown", (e) => {
  if (e.target.closest("#canvasContainer")) {
    drawing = true;
    currentStroke = [];
  }
});

document.addEventListener("mousemove", (e) => {
  if (!drawing) return;
  const pos = getMousePos(e);
  currentStroke.push(pos);
  drawSegment(contexts[currentLayer], currentStroke);
});

document.addEventListener("mouseup", async () => {
  if (!drawing || currentStroke.length === 0) { drawing = false; return; }
  drawing = false;
  const ref = collection(db, "rooms", roomId, "pages", "page1", "layers", currentLayer, "strokes");
  await addDoc(ref, {
    points: currentStroke, color, size, tool, timestamp: Date.now()
  });
});

// 단축키 (Ctrl + Z)
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    undoLastStroke();
  }
});

// 줌 (Wheel)
document.getElementById("viewport").onwheel = (e) => {
  e.preventDefault();
  const viewport = document.getElementById("viewport");
  const container = document.getElementById("canvasContainer");
  const rect = viewport.getBoundingClientRect();
  const mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top;
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const nextScale = Math.min(Math.max(0.1, scale * delta), 10);
  const worldX = (mouseX - offset.x) / scale;
  const worldY = (mouseY - offset.y) / scale;
  scale = nextScale;
  offset.x = mouseX - worldX * scale;
  offset.y = mouseY - worldY * scale;
  container.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${scale})`;
  document.getElementById("zoomLevel").innerText = `${Math.round(scale * 100)}%`;
};

// 툴 및 설정 변경
document.getElementById("brush").onclick = (e) => { tool = "brush"; setActiveTool(e.target); };
document.getElementById("eraser").onclick = (e) => { tool = "eraser"; setActiveTool(e.target); };
document.getElementById("color").oninput = (e) => color = e.target.value;

// 브러쉬 크기 (숫자 입력창 & 슬라이더 연동)
const sizeInput = document.getElementById("size");
const sizeRange = document.getElementById("sizeRange");

function updateBrushSize(val) {
  let v = parseInt(val);
  if (isNaN(v) || v < 1) v = 1;
  if (v > 100) v = 100;
  size = v;
  sizeInput.value = v;
  sizeRange.value = v;
}

sizeInput.oninput = (e) => updateBrushSize(e.target.value);
sizeRange.oninput = (e) => updateBrushSize(e.target.value);

function setActiveTool(btn) {
  document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
}

// 레이어 추가 및 내보내기
document.getElementById("addLayer").onclick = () => createLayer(`layer${layers.length + 1}`);
document.getElementById("export").onclick = () => {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = 1920; exportCanvas.height = 1080;
  const ctx = exportCanvas.getContext("2d");
  layers.sort((a,b) => a.order - b.order).forEach(l => {
    ctx.globalAlpha = l.opacity;
    ctx.drawImage(canvases[l.id], 0, 0);
  });
  const link = document.createElement("a");
  link.download = "drawing.png";
  link.href = exportCanvas.toDataURL();
  link.click();
};

// 초기 실행
createLayer("layer1");