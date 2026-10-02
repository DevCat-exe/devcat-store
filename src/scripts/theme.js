// Dark mode toggle functionality
document.addEventListener('DOMContentLoaded', function() {
  // Check for saved theme preference or default to dark mode
  const currentTheme = localStorage.getItem('theme') || 'dark';
  
  if (currentTheme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.add('dark');
  }

  // Create theme toggle button (optional - can be added to header)
  function createThemeToggle() {
    const button = document.createElement('button');
    button.className = 'p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-border-dark rounded-lg transition-colors';
    button.innerHTML = '<span class="material-symbols-outlined">dark_mode</span>';
    button.onclick = toggleTheme;
    return button;
  }

  // Toggle theme function
  window.toggleTheme = function() {
    const isDark = document.documentElement.classList.contains('dark');
    
    if (isDark) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
  };
});