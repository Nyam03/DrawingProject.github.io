import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, 
  limit, getDocs, updateDoc, where, writeBatch, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { 
  getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

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
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// --- 2. 상태 관리 ---
const roomId = "room1";
let currentUser = null;
let currentLayer = "layer1";
let tool = "brush", color = "#000000", size = 5;
let layers = []; 
let canvases = {}, contexts = {}, unsubscribes = {};
let scale = 1, offset = { x: 0, y: 0 };
let drawing = false, currentStroke = [];

// --- 3. 인증 및 접속자 관리 ---
const loginOverlay = document.getElementById("loginOverlay");
const appDiv = document.getElementById("app");
const googleLoginBtn = document.getElementById("googleLoginBtn");

googleLoginBtn.onclick = () => signInWithPopup(auth, provider);

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    loginOverlay.style.display = "none";
    appDiv.style.display = "flex";
    
    await setDoc(doc(db, "rooms", roomId, "users", user.uid), {
      name: user.displayName,
      photo: user.photoURL,
      lastActive: Date.now()
    });
    
    initApp();
    listenUsers();
    listenResetTrigger();
  } else {
    loginOverlay.style.display = "flex";
    appDiv.style.display = "none";
  }
});

function listenUsers() {
  const userListDiv = document.getElementById("userList");
  onSnapshot(collection(db, "rooms", roomId, "users"), (snap) => {
    userListDiv.innerHTML = "";
    snap.forEach(doc => {
      const u = doc.data();
      const chip = document.createElement("div");
      chip.className = "user-chip";
      chip.innerHTML = `<img src="${u.photo}">${u.name}`;
      userListDiv.appendChild(chip);
    });
  });
}

function initApp() {
  if (layers.length === 0) createLayer("layer1", "Base Layer");
}

// --- 4. 레이어 관리 함수 ---
document.getElementById("addLayer").onclick = () => {
  if (layers.length >= 5) {
    alert("레이어는 최대 5개까지만 생성 가능합니다.");
    return;
  }
  // 사용 가능한 가장 작은 번호 찾기 (Layer 1~5)
  const existingNums = layers.map(l => parseInt(l.displayName.replace("Layer ", "")) || 0);
  let nextNum = 1;
  while(existingNums.includes(nextNum)) nextNum++;
  
  const newId = `layer_${Date.now()}`;
  createLayer(newId, `Layer ${nextNum}`);
};

function createLayer(layerId, displayName) {
  const container = document.getElementById("canvasContainer");
  if (canvases[layerId]) return;

  const canvas = document.createElement("canvas");
  canvas.width = 1920; canvas.height = 1080;
  canvas.classList.add("layerCanvas");
  canvas.id = `canvas-${layerId}`;
  container.appendChild(canvas);

  canvases[layerId] = canvas;
  contexts[layerId] = canvas.getContext("2d");

  const maxOrder = layers.length > 0 ? Math.max(...layers.map(l => l.order)) : 0;
  const newLayer = { id: layerId, displayName: displayName, order: maxOrder + 1, opacity: 1 };
  layers.push(newLayer);
  
  currentLayer = layerId;
  listenLayer(layerId);
  updateLayerUI();
}

function deleteLayer(layerId) {
  if (layers.length <= 1) {
    alert("최소 하나의 레이어는 필요합니다.");
    return;
  }
  if (!confirm(`이 레이어를 삭제하시겠습니까?`)) return;

  const canvas = canvases[layerId];
  if (canvas) canvas.remove();

  if (unsubscribes[layerId]) {
    unsubscribes[layerId]();
    delete unsubscribes[layerId];
  }

  delete canvases[layerId];
  delete contexts[layerId];
  layers = layers.filter(l => l.id !== layerId);

  if (currentLayer === layerId) {
    currentLayer = layers[layers.length - 1].id;
  }

  updateLayerUI();
}

function moveLayer(layerId, direction) {
  const sorted = [...layers].sort((a, b) => a.order - b.order);
  const currentIdx = sorted.findIndex(l => l.id === layerId);

  if (direction === 'up' && currentIdx < sorted.length - 1) {
    const nextLayer = sorted[currentIdx + 1];
    const tempOrder = sorted[currentIdx].order;
    sorted[currentIdx].order = nextLayer.order;
    nextLayer.order = tempOrder;
  } else if (direction === 'down' && currentIdx > 0) {
    const prevLayer = sorted[currentIdx - 1];
    const tempOrder = sorted[currentIdx].order;
    sorted[currentIdx].order = prevLayer.order;
    prevLayer.order = tempOrder;
  }

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
        <span>${layer.displayName}</span>
        <div class="layer-controls">
          <button class="up-btn" title="위로">▲</button>
          <button class="down-btn" title="아래로">▼</button>
          <button class="del-btn" title="삭제">-</button>
        </div>
      </div>
      <input type="range" min="0" max="1" step="0.1" value="${layer.opacity}">
    `;

    div.onclick = (e) => {
      if(e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
        currentLayer = layer.id;
        updateLayerUI();
      }
    };

    div.querySelector(".up-btn").onclick = (e) => { e.stopPropagation(); moveLayer(layer.id, 'up'); };
    div.querySelector(".down-btn").onclick = (e) => { e.stopPropagation(); moveLayer(layer.id, 'down'); };
    div.querySelector(".del-btn").onclick = (e) => { e.stopPropagation(); deleteLayer(layer.id); };
    
    div.querySelector("input").oninput = (e) => {
      layer.opacity = e.target.value;
      canvases[layer.id].style.opacity = layer.opacity;
    };

    list.appendChild(div);
    if (canvases[layer.id]) canvases[layer.id].style.zIndex = layer.order;
  });
}

// --- 5. 드로잉 로직 (경로 통일: "strokes" 컬렉션 사용) ---

function listenLayer(layerId) {
  if (unsubscribes[layerId]) unsubscribes[layerId]();

  const q = query(
    collection(db, "strokes"),
    where("roomId", "==", roomId),
    where("layerId", "==", layerId),
    where("visible", "==", true),
    orderBy("timestamp", "asc")
  );

  unsubscribes[layerId] = onSnapshot(q, (snapshot) => {
    const ctx = contexts[layerId];
    if (!ctx) return;
    ctx.clearRect(0, 0, canvases[layerId].width, canvases[layerId].height);

    snapshot.docs.forEach((doc) => {
      const s = doc.data();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.lineWidth = s.size; ctx.strokeStyle = s.color;
      ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";

      ctx.beginPath();
      s.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    });
  });
}

function getMousePos(e) {
  const rect = canvases[currentLayer].getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvases[currentLayer].width / rect.width),
    y: (e.clientY - rect.top) * (canvases[currentLayer].height / rect.height)
  };
}

function drawSegment(ctx, points) {
  if (points.length < 2) return;
  const p1 = points[points.length - 2], p2 = points[points.length - 1];
  ctx.lineWidth = size; ctx.lineCap = ctx.lineJoin = "round";
  ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = color;
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
}

// --- 6. Undo / Redo / Reset (경로 통일) ---

async function undoLastStroke() {
  const q = query(
    collection(db, "strokes"),
    where("roomId", "==", roomId),
    where("layerId", "==", currentLayer),
    where("userId", "==", currentUser.uid),
    where("visible", "==", true),
    orderBy("timestamp", "desc"),
    limit(1)
  );
  const snap = await getDocs(q);
  snap.forEach(async (d) => await updateDoc(doc(db, "strokes", d.id), { visible: false }));
}

async function redoLastStroke() {
  const q = query(
    collection(db, "strokes"),
    where("roomId", "==", roomId),
    where("layerId", "==", currentLayer),
    where("userId", "==", currentUser.uid),
    where("visible", "==", false),
    orderBy("timestamp", "desc"),
    limit(1)
  );
  const snap = await getDocs(q);
  snap.forEach(async (d) => await updateDoc(doc(db, "strokes", d.id), { visible: true }));
}

async function clearRedoStack() {
  const q = query(
    collection(db, "strokes"), 
    where("roomId", "==", roomId),
    where("layerId", "==", currentLayer),
    where("userId", "==", currentUser.uid), 
    where("visible", "==", false)
  );
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// 리셋 버튼: 모든 레이어의 선 데이터를 한 번에 삭제
document.getElementById('reset-btn').onclick = async () => {
  if (!confirm("모든 레이어의 그림을 초기화하시겠습니까?")) return;
  try {
    const q = query(collection(db, "strokes"), where("roomId", "==", roomId));
    const snap = await getDocs(q);
    if (snap.empty) { alert("초기화할 내용이 없습니다."); return; }

    const batch = writeBatch(db);
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    await setDoc(doc(db, "rooms", roomId), { resetAt: Date.now() }, { merge: true });
    alert("캔버스가 초기화되었습니다.");
  } catch (e) { console.error(e); }
};

// --- 7. 이벤트 리스너 ---

document.addEventListener("mousedown", (e) => {
  if (e.target.closest("#canvasContainer") && currentUser) {
    drawing = true; currentStroke = [];
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
  await clearRedoStack();
  await addDoc(collection(db, "strokes"), {
    roomId, layerId: currentLayer, points: currentStroke, 
    color, size, tool, timestamp: Date.now(), visible: true,
    userId: currentUser.uid, userName: currentUser.displayName
  });
});

document.addEventListener("keydown", (e) => {
  const isCtrl = e.ctrlKey || e.metaKey;
  if (isCtrl && e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); redoLastStroke(); }
  else if (isCtrl && e.key.toLowerCase() === "z") { e.preventDefault(); undoLastStroke(); }
});

// 줌 설정
document.getElementById("viewport").onwheel = (e) => {
  e.preventDefault();
  const container = document.getElementById("canvasContainer");
  const rect = document.getElementById("viewport").getBoundingClientRect();
  const mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top;
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const nextScale = Math.min(Math.max(0.1, scale * delta), 10);
  const worldX = (mouseX - offset.x) / scale, worldY = (mouseY - offset.y) / scale;
  scale = nextScale;
  offset.x = mouseX - worldX * scale; offset.y = mouseY - worldY * scale;
  container.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${scale})`;
  document.getElementById("zoomLevel").innerText = `${Math.round(scale * 100)}%`;
};

document.getElementById("brush").onclick = (e) => { tool = "brush"; setActiveTool(e.target); };
document.getElementById("eraser").onclick = (e) => { tool = "eraser"; setActiveTool(e.target); };
document.getElementById("color").oninput = (e) => color = e.target.value;
document.getElementById("size").oninput = (e) => updateBrushSize(e.target.value);
document.getElementById("sizeRange").oninput = (e) => updateBrushSize(e.target.value);

function updateBrushSize(val) {
  size = Math.min(Math.max(parseInt(val) || 1, 1), 100);
  document.getElementById("size").value = size;
  document.getElementById("sizeRange").value = size;
}

function setActiveTool(btn) {
  document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
}

document.getElementById("export").onclick = () => {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = 1920; exportCanvas.height = 1080;
  const ctx = exportCanvas.getContext("2d");
  [...layers].sort((a,b) => a.order - b.order).forEach(l => {
    ctx.globalAlpha = l.opacity;
    ctx.drawImage(canvases[l.id], 0, 0);
  });
  const link = document.createElement("a");
  link.download = "drawing.png"; link.href = exportCanvas.toDataURL(); link.click();
};

function clearAllCanvases() {
  Object.keys(contexts).forEach(id => contexts[id].clearRect(0,0,1920,1080));
}

function listenResetTrigger() {
  onSnapshot(doc(db, "rooms", roomId), (snap) => {
    if (snap.data()?.resetAt) clearAllCanvases();
  });
}