const colorRed = "#CB1446";
const colorGreen = "#2AA850";
const colorBlue = "#2E83F3";
const colorOrange = "#FF6700";
let sidebarState = false;
let globalSecretKey = null;
let globalFileBucket = {};
let globalFolderQueue = [];
let globalConsumption = 0;
let globalMediaBlob = null;
let globalContextFile = null;
let globalContextFolder = null;
let globalContextOption = null;
let sidebar = document.querySelector('.sidebar');
let blurLayer = document.querySelector('.blur-layer');
let mainSection = document.querySelector('#main');
let secondarySection = document.querySelector('#secondary');
let taskQueueElem = document.querySelector('.queue');
let totalSizeWidget = document.querySelector('.bottom_option');
let extraRenderingPanel = document.querySelector('.extras');
let extraPanelState = false;

function getContextOptionElem(option) {
    let options = {
        "home" : homeButton,
        "all-files" : allFilesButton,
        "pdfs" : pdfButton,
        "images" : imgButton,
        "videos" : videoButton,
        "audios" : audioButton,
        "docs" : docsButton,
        "queue" : queueButton,
        "others" : otherButton,
    }
    return options[option];
}

function switchView(primary = true, secondary = false) {
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }
    fileOptionPanel.style.display = 'none';
    let header = document.querySelector('header');
    if (primary) {
        header.style.display = 'flex';
        mainSection.style.display = 'flex';
        if (extraPanelState) {
            extraRenderingPanel.style.display = 'flex';
        }
    } else {
        header.style.display = 'none';
        mainSection.style.display = 'none';
        extraRenderingPanel.style.display = 'none';
    }
    if (secondary) {
        header.style.display = 'none';
        secondarySection.style.display = 'flex';
        extraRenderingPanel.style.display = 'none';
    } else {
        header.style.display = 'flex';
        secondarySection.style.display = 'none';
        if (extraPanelState) {
            extraRenderingPanel.style.display = 'flex';
        }
    }
}

function sidebarEventState(enable = true) {
    if (!enable) {
        blurLayer.style.display = 'none';
        sidebar.style.display = 'none';
        floatingMenuButton.innerHTML = `<i class="fa-solid fa-bars"></i>`;
        sidebarState = false;
    } else {
        if (window.innerWidth < 768) {
            blurLayer.style.display = 'block';
        }
        sidebar.style.display = 'flex';
        floatingMenuButton.innerHTML = `<i class="fa-solid fa-times"></i>`;
        sidebarState = true;
    }
}

let floatingMenuButton = document.querySelector('.floating_menu');
floatingMenuButton.addEventListener('click', () => {
    if (sidebarState) {
        blurLayer.style.display = 'none';
        sidebar.style.display = 'none';
        floatingMenuButton.innerHTML = `<i class="fa-solid fa-bars"></i>`;
        sidebarState = false;
    } else {
        if (window.innerWidth < 768) {
            blurLayer.style.display = 'block';
        }
        sidebar.style.display = 'flex';
        floatingMenuButton.innerHTML = `<i class="fa-solid fa-times"></i>`;
        sidebarState = true;
    }
});

let uploadButton = document.querySelector('#upload-file');
let fileInput = document.querySelector('#input-file');
uploadButton.addEventListener('click', () => {
    fileInput.click();
});
fileInput.addEventListener('change', () => {
    for (let i = 0; i < fileInput.files.length; i++) {
        upload(fileInput.files[i]);
    }
});

let newFolderButton = document.querySelector('#new-folder');
newFolderButton.addEventListener('click', () => {
    createFolder();
});

let sidebarOptions = document.querySelectorAll('.sidebar_option');
let previousOption = null;
for (let i = 0; i < sidebarOptions.length; i++) {
    sidebarOptions[i].addEventListener('click', () => {
        let currOption = sidebarOptions[i]
        currOption.style.borderLeft = '5px solid #2e83f3a8';
        currOption.style.backgroundColor = '#ffffff09';
        if (previousOption && previousOption !== currOption) {
            previousOption.style.borderLeft = '5px solid transparent';
            previousOption.style.backgroundColor = 'transparent';
        }
        previousOption = currOption;
    });
}

let homeButton = document.querySelector('#home');
homeButton.addEventListener('click', () => {
    globalContextOption = "home";
    switchView();
    globalFileBucket = {};
    let pinnedBlock = null;
    let recentBlock = null;
    Promise.all([
        fetch("/api/query", {
            method: 'POST',
            body: JSON.stringify({"pinned": true}),
        })
        .then(response => response.json())
        .then(data => {
            if (data.length > 0) {
                pinnedBlock = buildPinnedContent(data);
            }
            data.forEach((file) => {
                globalFileBucket[file.hash] = file;
            });
        }),
        fetch("/api/metadata")
        .then(response => response.json())
        .then(data => {
            let sortedData = sortRecentFilesByTimeStamp(data);
            sortedData = sortedData.slice(0, 9);
            if (sortedData.length > 0) {
                recentBlock = buildRecentContent(sortedData);
            }
            sortedData.forEach((file) => {
                globalFileBucket[file.hash] = file;
            });
        })
    ]).then(() => {
        let homePage = buildHomePage(pinnedBlock, recentBlock);
        mainSection.innerHTML = '';
        mainSection.appendChild(homePage);
    });
});

let allFilesButton = document.querySelector('#my-files');
allFilesButton.addEventListener('click', () => {
    globalContextOption = "all-files";
    switchView();
    globalFileBucket = {};
    globalFolderQueue = [];
    fetch("/api/metadata")
    .then(response => response.json())
    .then(data => {
        let folders = [];
        let files = [];
        data.forEach((file) => {
            globalFileBucket[file.hash] = file;
            if (file.type === 'folder') {
                folders.push(file);
            } else {
                files.push(file);
            }
        });
        let allFilesData = folders.concat(files);
        let allFiles = buildAllFilesList(allFilesData);
        mainSection.innerHTML = '';
        mainSection.appendChild(buildAllFilesPage(allFiles));
        if (window.innerWidth < 768) {
            sidebarEventState(false);
        }
        updatePromptFragment();
    })
});

let queueButton = document.querySelector('#queue');
queueButton.addEventListener('click', () => {
    globalContextOption = "queue";
    switchView(false, true);
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }
});

let pdfButton = document.querySelector('#pdf');
pdfButton.addEventListener('click', () => {
    globalContextOption = "pdfs";
    renderCategory({"mime": "application/pdf"});
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }
});

let docsButton = document.querySelector('#docs');
docsButton.addEventListener('click', () => {
    globalContextOption = "docs";
    renderCategory({"mime?contains": "text"});
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }
});

let imgButton = document.querySelector('#image');
imgButton.addEventListener('click', () => {
    globalContextOption = "images";
    renderCategory({"mime?contains": "image"});
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }
});

let audioButton = document.querySelector('#audio');
audioButton.addEventListener('click', () => {
    globalContextOption = "audios";
    renderCategory({"mime?contains": "audio"});
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }
});

let videoButton = document.querySelector('#video');
videoButton.addEventListener('click', () => {
    globalContextOption = "videos";
    renderCategory({"mime?contains": "video"});
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }
});

let otherButton = document.querySelector('#others');
otherButton.addEventListener('click', () => {
    globalContextOption = "others";
    renderCategory({"mime?contains": "application", "mime?not_contains": "pdf"});
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }
});

let searchBar = document.querySelector('#search-bar');
let inputTimer = null;
searchBar.addEventListener('input', () => {
    if (inputTimer) {
        clearTimeout(inputTimer);
    }
    inputTimer = setTimeout(() => {
        let query = searchBar.value;
        if (query.length === 0) {
            getContextOptionElem(globalContextOption).click();
            return;
        }
        fetch(`/api/query`, {
            method: "POST",
            body: JSON.stringify({"name?contains": query}),
        })
        .then(response => response.json())
        .then(data => {
            data = data.filter((file) => {
                return !(file.type === 'folder');
            });
            data.forEach((file) => {
                globalFileBucket[file.hash] = file;
            });
            let resultsPage = document.createElement('div');
            resultsPage.className = 'my_files';
            if (data.length > 0) {
                let p = document.createElement('p');
                p.innerHTML = `Search results for '${query}'`;
                resultsPage.appendChild(p);
                resultsPage.appendChild(buildAllFilesList(data));
                mainSection.innerHTML = '';
                mainSection.appendChild(resultsPage);
                switchView();
            } else {
                mainSection.innerHTML = '';
                let p = document.createElement('p');
                let symbol = `<i class="fa-solid fa-circle-exclamation"></i> `;
                p.innerHTML = `${symbol} No results found for '${query}'`;
                p.style.color = "rgb(247, 70, 70)";
                resultsPage.appendChild(p);
                mainSection.appendChild(resultsPage);
                switchView();
            }
        })
    }, 500);
});

mainSection.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
});

mainSection.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.items) {
        [...e.dataTransfer.items].forEach((item) => {
            upload(item.getAsFile());
        })
    }
});

let modal = document.querySelector('.modal');
let modalContent = document.querySelector('.modal_content');
modalContent.addEventListener('click', () => {
    handleModalClose();
});
let modalCloseButton = document.querySelector('.modal_close');
modalCloseButton.addEventListener('click', () => {
    handleModalClose();
});

function handleModalClose() {
    modal.style.display = 'none';
    modalContent.innerHTML = '';
    if (globalMediaBlob) {
        URL.revokeObjectURL(globalMediaBlob);
        globalMediaBlob = null;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    mainSection.style.display = 'none';
    secondarySection.style.display = 'none';
    fetch("/api/consumption")
    .then(response => response.json())
    .then(data => {
        globalConsumption = getTotalSize(data);
        let totalSizeString = handleSizeUnit(globalConsumption);
        totalSizeWidget.innerHTML = `<i class="fa-solid fa-database"></i>Used ${totalSizeString}`;
    })
    homeButton.click();
    fetch("/api/secret")
    .then(response => response.text())
    .then(data => {
        globalSecretKey = data;
    })
});

window.addEventListener('resize', () => {
    blurLayer.style.display = 'none';
    if (window.innerWidth > 768) {
        sidebar.style.display = 'flex';
        sidebarState = true;
    } else {
        sidebar.style.display = 'none';
        floatingMenuButton.display = 'block';
        floatingMenuButton.innerHTML = `<i class="fa-solid fa-bars"></i>`;
        sidebarState = false;
    }
});

window.addEventListener("paste", (e) => {
    let items = e.clipboardData.items;
    if (items) {
        [...items].forEach((item) => {
            if (item.kind === "file") {
                upload(item.getAsFile());
            }
        })
    }
});