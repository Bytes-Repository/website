document.addEventListener('DOMContentLoaded', function() {
    const hamburger = document.querySelector('.hamburger');
    const navUl = document.querySelector('nav ul');

    if (hamburger) {
        hamburger.addEventListener('click', function() {
            navUl.classList.toggle('active');
        });
    }

    // Search Functionality for Repository Page
    const searchInput = document.getElementById('search');
    const packageList = document.querySelector('.package-list');

    if (searchInput && packageList) {
        searchInput.addEventListener('input', function() {
            const filter = searchInput.value.toLowerCase();
            const items = packageList.getElementsByTagName('li');

            Array.from(items).forEach(function(item) {
                const text = item.textContent.toLowerCase();
                if (text.indexOf(filter) > -1) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }
});
