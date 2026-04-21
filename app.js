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
let currentUser = null; // 현재 로그인 유저 정보
let currentLayer = "layer1";
let tool = "brush", color = "#000000", size = 5;
let layers = []; 
let canvases = {}, contexts = {};
let scale = 1, offset = { x: 0, y: 0 };
let drawing = false, currentStroke = [];
let heartbeatInterval;

// --- 3. 인증 및 접속자 관리 ---
const loginOverlay = document.getElementById("loginOverlay");
const appDiv = document.getElementById("app");
const googleLoginBtn = document.getElementById("googleLoginBtn");

googleLoginBtn.onclick = () => signInWithPopup(auth, provider);

async function updatePresence(user) {
  if (!user) return;
  const userRef = doc(db, "rooms", roomId, "users", user.uid);
  await setDoc(userRef, {
    name: user.displayName || "익명",
    photo: user.photoURL || "",
    lastSeen: Date.now(), // 현재 시간을 기록
    online: true
  }, { merge: true });
}

// 2. 활동 중단(나감) 처리 함수
async function setOffline(uid) {
  if (!uid) return;
  const userRef = doc(db, "rooms", roomId, "users", uid);
  await updateDoc(userRef, { online: false });
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginOverlay.style.display = "none";
    appContainer.style.display = "flex";
    
    // 접속하자마자 상태 업데이트
    updatePresence(user);

    // 30초마다 나 아직 있다고 신호 보내기 (Heartbeat)
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => updatePresence(user), 60000);

    // 창을 닫거나 나갈 때 오프라인 처리
    window.addEventListener('beforeunload', () => setOffline(user.uid));
    
    listenUserList();
    layers.forEach(l => listenLayer(l.id));
  } else {
    loginOverlay.style.display = "flex";
    appContainer.style.display = "none";
  }
});

// 3. 사용자 리스트 감시 (일정 시간 지난 사람 필터링)
function listenUserList() {
  const usersRef = collection(db, "rooms", roomId, "users");
  onSnapshot(usersRef, (snapshot) => {
    const userListDiv = document.getElementById("userList");
    userListDiv.innerHTML = "";
    
    const now = Date.now();
    const threshold = 5 * 60 * 1000;

    snapshot.docs.forEach((docSnap) => {
      const userData = docSnap.data();
      
      if (userData.online && (now - userData.lastSeen < threshold)) {
        const img = document.createElement("img");
        img.src = userData.photo || "https://via.placeholder.com/30";
        img.title = userData.name;
        img.className = "user-avatar";
        userListDiv.appendChild(img);
      }
    });
  });
}

function initApp() {
  if (layers.length === 0) createLayer("layer1");
}

// --- 4. 레이어 관리 함수 ---
function createLayer(layerId) {
  const container = document.getElementById("canvasContainer");
  if (canvases[layerId]) return;

  const canvas = document.createElement("canvas");
  canvas.width = 1920; canvas.height = 1080;
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
      <div class="layer-top"><span>${layer.id}</span></div>
      <input type="range" min="0" max="1" step="0.1" value="${layer.opacity}">
    `;
    div.onclick = () => { currentLayer = layer.id; updateLayerUI(); };
    div.querySelector("input").oninput = (e) => {
      layer.opacity = e.target.value;
      canvases[layer.id].style.opacity = layer.opacity;
    };
    list.appendChild(div);
  });
}

// --- 5. 드로잉 로직 ---
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
  ctx.lineWidth = size;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = color;
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
}

function listenLayer(layerId) {
  const q = query(
    collection(db, "strokes"),
    where("roomId", "==", roomId),
    where("layerId", "==", layerId),
    where("visible", "==", true),
    orderBy("timestamp", "asc")
  );

  onSnapshot(q, (snapshot) => {
    const ctx = contexts[layerId];
    if (!ctx) return;
    ctx.clearRect(0, 0, canvases[layerId].width, canvases[layerId].height);

    snapshot.docs.forEach((doc) => {
      const s = doc.data();
      
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = s.size;
      ctx.strokeStyle = s.color;
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

// --- 6. 사용자별 Undo / Redo (중요!) ---

async function undoLastStroke() {
  const ref = collection(db, "rooms", roomId, "pages", "page1", "layers", currentLayer, "strokes");
  // 내 ID(userId)이면서 보이는 것 중 마지막 데이터 검색
  const q = query(
    ref, 
    where("userId", "==", currentUser.uid), 
    where("visible", "==", true), 
    orderBy("timestamp", "desc"), 
    limit(1)
  );
  const snap = await getDocs(q);
  snap.forEach(async (d) => await updateDoc(doc(db, ref.path, d.id), { visible: false }));
}

async function redoLastStroke() {
  const ref = collection(db, "rooms", roomId, "pages", "page1", "layers", currentLayer, "strokes");
  // 내 ID(userId)이면서 숨겨진 것 중 마지막 데이터 검색
  const q = query(
    ref, 
    where("userId", "==", currentUser.uid), 
    where("visible", "==", false), 
    orderBy("timestamp", "desc"), 
    limit(1)
  );
  const snap = await getDocs(q);
  snap.forEach(async (d) => await updateDoc(doc(db, ref.path, d.id), { visible: true }));
}

async function clearRedoStack() {
  const ref = collection(db, "rooms", roomId, "pages", "page1", "layers", currentLayer, "strokes");
  const q = query(ref, where("userId", "==", currentUser.uid), where("visible", "==", false));
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

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
  const ref = collection(db, "rooms", roomId, "pages", "page1", "layers", currentLayer, "strokes");
  await addDoc(ref, {
    points: currentStroke, color, size, tool, 
    timestamp: Date.now(), 
    visible: true,
    userId: currentUser.uid, // 선 데이터에 사용자 ID 저장
    userName: currentUser.displayName
  });
});

document.addEventListener("keydown", (e) => {
  const isCtrl = e.ctrlKey || e.metaKey;
  if (isCtrl && e.shiftKey && e.key.toLowerCase() === "z") {
    e.preventDefault(); redoLastStroke();
  } else if (isCtrl && e.key.toLowerCase() === "z") {
    e.preventDefault(); undoLastStroke();
  }
});

// 줌 및 기타 설정 (기존과 동일)
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
  layers.sort((a,b) => a.order - b.order).forEach(l => {
    ctx.globalAlpha = l.opacity;
    ctx.drawImage(canvases[l.id], 0, 0);
  });
  const link = document.createElement("a");
  link.download = "drawing.png"; link.href = exportCanvas.toDataURL(); link.click();
};

// 리셋 버튼 이벤트 리스너
const resetBtn = document.getElementById('reset-btn');

resetBtn.addEventListener('click', async () => {
  if (!confirm("정말로 전체 캔버스를 초기화하시겠습니까?")) return;

  try {
    let totalDeleted = 0;

    for (const layer of layers) {
      const ref = collection(
        db,
        "rooms", roomId,
        "pages", "page1",
        "layers", layer.id,
        "strokes"
      );

      const snap = await getDocs(ref);

      if (!snap.empty) {
        const batch = writeBatch(db);

        snap.forEach((docSnap) => {
          batch.delete(docSnap.ref);
          totalDeleted++;
        });

        await batch.commit();
      }
    }

    if (totalDeleted === 0) {
      alert("이미 비어있는 상태입니다.");
      return;
    }
    await setDoc(doc(db, "rooms", roomId), {
      resetAt: Date.now()
    }, { merge: true });

    alert("캔버스가 완전히 초기화되었습니다.");

  } catch (error) {
    console.error("초기화 실패:", error);
    alert("초기화 실패: " + error.message);
  }
});

function clearAllCanvases() {
  Object.keys(contexts).forEach(layerId => {
    const ctx = contexts[layerId];
    const canvas = canvases[layerId];
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });
}

function listenResetTrigger() {
  onSnapshot(doc(db, "rooms", roomId), (snap) => {
    const data = snap.data();
    if (!data) return;

    // resetAt 값이 있으면 무조건 클리어
    if (data.resetAt) {
      clearAllCanvases();
    }
  });
}