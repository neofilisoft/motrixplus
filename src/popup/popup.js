document.addEventListener('DOMContentLoaded', () => {
  // จัดการการคลิกแท็บ (Active / Waiting / Stopped)
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // ลบ class active ออกจากทุกปุ่ม
      tabBtns.forEach(b => b.classList.remove('active'));
      // เพิ่ม class active ให้ปุ่มที่กด
      btn.classList.add('active');
      
      const tab = btn.dataset.tab;
      console.log('Switched to tab:', tab);
      // TODO: เขียนโค้ดดึงข้อมูล Task ตาม tab ที่เลือกตรงนี้
    });
  });

  // จัดการการเปิด-ปิดหน้า Settings Drawer
  const btnSettings = document.getElementById('btn-settings');
  const btnBack = document.getElementById('btn-back');
  const drawer = document.querySelector('.settings-drawer');

  if (btnSettings && drawer) {
    btnSettings.addEventListener('click', () => {
      drawer.classList.add('open'); // เลื่อนหน้า Settings ขึ้นมา
    });
  }

  if (btnBack && drawer) {
    btnBack.addEventListener('click', () => {
      drawer.classList.remove('open'); // ซ่อนหน้า Settings
    });
  }

  // Add URL
  const btnAdd = document.getElementById('btn-add');
  const inputUrl = document.getElementById('input-url');
  
  if (btnAdd && inputUrl) {
    btnAdd.addEventListener('click', () => {
      const url = inputUrl.value.trim();
      if (url) {
        console.log('Adding URL:', url);
        // TODO: ส่ง URL ไปที่ background.js เพื่อดาวน์โหลด
        inputUrl.value = ''; // ล้างช่อง input
      }
    });
  }
});