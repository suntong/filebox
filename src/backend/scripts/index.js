const colorRed = "#CB1446";
const colorGreen = "#2AA850";
const colorBlue = "#2E83F3";
const colorOrange = "#FF6700";
let runningTaskCount = 0;
let sidebarState = false;
let globalSecretKey = null;
let globalProjectId = null;
let globalUserId = null;
let globalFolderQueue = [];
let globalConsumption = 0;
let globalMediaBlob = null;
let globalContextFile = null;
let globalContextFolder = null;
let globalContextOption = null;
let isFileMoving = false;
let isUserSubscribed = false;
let globalTrashFiles = null;
let globalMultiSelectBucket = [];
let sidebar = document.querySelector('.sidebar');
let blurLayer = document.querySelector('.blur-layer');
let mainSection = document.querySelector('#main');
let taskQueueElem = document.querySelector('.queue');
let totalSizeWidget = document.querySelector('#storage');

const nativeFetch = window.fetch;
window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (response.status === 502) {
        showSnack("Bad Gateway! Try again.", colorOrange, 'warning');
    }
    return response;
};

function filterNonDeletedFiles(files) {
    return files.filter((file) => {
        if (file.deleted !== true) {
            return true;
        }
    });
}

function getContextOptionElem(option) {
    let options = {
        "home" : homeButton,
        "my-files" : myFilesButton,
        "pdfs" : pdfButton,
        "images" : imgButton,
        "videos" : videoButton,
        "audios" : audioButton,
        "docs" : docsButton,
        "queue" : queueButton,
        "others" : otherButton,
        "trash": trashButton,
        "shared": instancesButton,
    }
    return options[option];
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

function sidebarOptionSwitch() {
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }
    renderOriginalHeader();
    globalContextFolder = null;
    fileOptionPanel.style.display = 'none';
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
    globalContextFolder = null;
    fileOptionPanel.style.display = 'none';
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }
    renderOriginalHeader();
    let pinnedBlock = null;
    let recentBlock = null;
    Promise.all([
        fetch("/api/query", {
            method: 'POST',
            body: JSON.stringify({"pinned": true, "deleted?ne": true}),
        })
        .then(response => response.json())
        .then(data => {
            if (data) {
                pinnedBlock = buildPinnedContent(data);
            }
        }),
        fetch("/api/metadata")
        .then(response => response.json())
        .then(data => {
            if (data) {
                data = sortFileByTimestamp(data)
                if (data.length > 0) {
                    recentBlock = buildRecentUL(data.slice(0, 9));
                }
            }
        })
    ])
    .then(() => {
        let homePage = buildHomePage(pinnedBlock, recentBlock);
        mainSection.innerHTML = '';
        mainSection.appendChild(homePage);
    });
});

let myFilesButton = document.querySelector('#my-files');
myFilesButton.addEventListener('click', () => {
    globalContextOption = "my-files";
    globalContextFolder = null;
    fileOptionPanel.style.display = 'none';
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }
    if (!isFileMoving) {
        renderOriginalHeader();
    }
    globalFolderQueue = [];
    fetch("/api/metadata")
    .then(response => response.json())
    .then(data => {
        let files = [];
        let folders = [];
        data.forEach((file) => {
            if (file.type === 'folder') {
                folders.push(file);
            } else {
                files.push(file);
            }
        });
        let myFiles = buildMyFilesBlock(buildAllFileUL(folders.concat(files)));
        mainSection.innerHTML = '';
        mainSection.appendChild(myFiles);
        updateFolderStats(folders);
        updatePromptFragment();
    })
});

let instancesButton = document.querySelector('#instances');
instancesButton.addEventListener('click', () => {
    globalContextOption = "shared";
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }
    if (!isFileMoving) {
        renderOriginalHeader();
    }
    mainSection.innerHTML = '';
    let fileList = document.createElement('div');
    fileList.className = 'file_list';
    fetch(`/api/instances`)
    .then((resp) => resp.json())
    .then(data => {
        if (data) {
            fileList.appendChild(buildTitleP('Warps'));
            fileList.appendChild(buildInstnaceList(data));
        }
    })
    .then(() => {
        fetch(`/api/query`, {
            method: "POST", 
            body: JSON.stringify(
                {"pending": true, "shared": true})
            })
        .then((resp) => {
            if (resp.status === 200) {
                connectButton.click();
                return resp.json();
            }
            return [];
        })
        .then(data => {
            if (data) {
                fileList.appendChild(buildTitleP('Pending Files'));
                fileList.appendChild(buildPendingFileList(data));
            }
            fetch("/api/query", {
                method: "POST", 
                body: JSON.stringify({"shared": true, "deleted?ne": true, "pending?ne": true})
            })
            .then(response => response.json())
            .then(data => {
                let ul = document.createElement('ul');
                ul.className = 'all_files';
                if (data) {
                    fileList.appendChild(buildTitleP('Files Received '));
                    data.forEach((file) => {
                        ul.appendChild(newFileElem(file));
                    });
                }
                fileList.appendChild(ul);
                mainSection.appendChild(fileList);
            });
        })
    })
});

let queueModal = document.querySelector('.queue');
let queueModalCloseButton = document.querySelector('.queue_close');
queueModalCloseButton.addEventListener('click', () => {
    queueModal.style.display = 'none';
});
let queueButton = document.querySelector('#queue');
queueButton.addEventListener('click', () => {
    if (runningTaskCount === 0) {
        showSnack("No tasks running", colorOrange, 'info')
        return;
    }
    globalContextOption = "queue";
    queueModal.style.display = 'block';
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }
});

let pdfButton = document.querySelector('#pdfs');
pdfButton.addEventListener('click', () => {
    globalContextOption = "pdfs";
    renderFilesByMime({"mime": "application/pdf"});
});

let docsButton = document.querySelector('#docs');
docsButton.addEventListener('click', () => {
    globalContextOption = "docs";
    renderFilesByMime({"mime?contains": "text"});
});

let imgButton = document.querySelector('#images');
imgButton.addEventListener('click', () => {
    globalContextOption = "images";
    renderFilesByMime({"mime?contains": "image"});
});

let audioButton = document.querySelector('#audios');
audioButton.addEventListener('click', () => {
    globalContextOption = "audios";
    renderFilesByMime({"mime?contains": "audio"});
});

let videoButton = document.querySelector('#videos');
videoButton.addEventListener('click', () => {
    globalContextOption = "videos";
    renderFilesByMime({"mime?contains": "video"});
});

let otherButton = document.querySelector('#others');
otherButton.addEventListener('click', () => {
    globalContextOption = "others";
    renderFilesByMime({"mime?contains": "application", "mime?not_contains": "pdf"});
});

let trashButton = document.querySelector('#trash');
trashButton.addEventListener('click', () => {
    sidebarOptionSwitch();
    globalContextOption = "trash";
    fetch("/api/query", {method: "POST", body: JSON.stringify({"deleted": true})})
    .then(response => response.json())
    .then(data => {
        mainSection.innerHTML = '';
        if (!data) {
            renderOriginalHeader();
            showSnack("There's nothing in the trash!", colorOrange, 'info');
            return;
        }
        let fileList = document.createElement('div');
        fileList.className = 'file_list';
        let ul = document.createElement('ul');
        ul.className = 'all_files';
        globalTrashFiles = data;
        data.forEach((file) => {
            ul.appendChild(newFileElem(file, true));
        });
        fileList.appendChild(ul);
        let trashOptios = document.createElement('div');
        trashOptios.className = ('trash_options');
        let p = document.createElement('p');
        p.innerHTML = 'Empty trash?';
        p.style.color = 'white';
        p.style.fontSize = '14px';
        trashOptios.appendChild(p);
        let emptyTrash = document.createElement('button');
        emptyTrash.innerHTML = '<i class="fa-solid fa-trash"></i>';
        emptyTrash.addEventListener('click', () => {
            fetch(`/api/bulk/${globalProjectId}`, {method: 'DELETE', body: JSON.stringify(globalTrashFiles)})
            .then(() => {
                showSnack('Trash Emptied Successfully!', colorGreen, 'success');
                let totalSpaceFreed = 0;
                globalTrashFiles.forEach((file) => {
                    if (file.shared) {
                        totalSpaceFreed += file.size;
                    }
                });
                updateSpaceUsage(-totalSpaceFreed);
                fileList.innerHTML = '';
                renderOriginalHeader();
            })
        });
        trashOptios.appendChild(emptyTrash);
        renderOtherHeader(trashOptios);
        mainSection.appendChild(fileList);
    });
    if (window.innerWidth < 768) {
        sidebarEventState(false);
    }    
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

function handleModalClose() {
    modal.style.display = 'none';
    modalContent.innerHTML = '';
    if (globalMediaBlob) {
        URL.revokeObjectURL(globalMediaBlob);
        globalMediaBlob = null;
    }
}

let modal = document.querySelector('.modal');
let modalContent = document.querySelector('.modal_content');
let modalCloseButton = document.querySelector('.modal_close');
modalCloseButton.addEventListener('click', () => {
    handleModalClose();
});

let connectButton = document.querySelector('#connect');
connectButton.addEventListener('click', () => {
    modalContent.innerHTML = '';
    modalContent.appendChild(buildConnectionModal());
    modal.style.display = 'block';
});
const f1 = document.querySelector('#f1');
const f2 = document.querySelector('#f2');
const f3 = document.querySelector('#f3');
const f4 = document.querySelector('#f4');

let fieldArray = [f1, f2, f3, f4];
let pin = '';
fieldArray.forEach((field, index) => {
    field.addEventListener('input', (e) => {
        pin += e.data;
        if (index < 3) {
            fieldArray[index + 1].focus();
        } else {
            fieldArray[index].blur();
            fetch(`/api/key/${pin}`)
            .then(response => {
                if (response.status == 200) {
                    return response.json();
                } else if (response.status == 404) {
                    showSnack('You did not set any PIN, check App Config.', colorOrange, 'info');
                    clearButton.click();
                    return;
                }
                else {
                    showSnack('Incorrect PIN', colorRed, 'error');
                    clearButton.click();
                }
            })
            .then(data => {
                globalSecretKey = data.key;
                globalProjectId = globalSecretKey.split('_')[0];
                globalUserId = /-(.*?)\./.exec(window.location.hostname)[1];
                let userName = document.querySelector('#username');
                userName.innerHTML = globalUserId;
                let userIcon = document.querySelector('#user-icon')
                userIcon.src = getAvatarURL(globalUserId, true);
                fetch("/api/consumption")
                .then(response => response.json())
                .then(data => {
                    updateSpaceUsage(data.size);
                })
                let pinModal = document.querySelector('.pin_entry');
                pinModal.style.display = 'none';
                homeButton.click();
            })
        }
    });
});

let clearButton = document.querySelector('#clear');
clearButton.addEventListener('click', () => {
    pin = '';
    fieldArray.forEach((field) => {
        field.value = '';
    });
    fieldArray[0].focus();
});


window.addEventListener('DOMContentLoaded', () => {
    renderOriginalHeader();
    f1.focus();
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
    let newTaskStarted = false;
    if (items.length) {
        [...items].forEach((item) => {
            if (item.kind === "file") {
                upload(item.getAsFile());
                newTaskStarted = true;
            }
        })
    }
    if (newTaskStarted) {
        queueButton.click();
    }
});