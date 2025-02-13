package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
	"github.com/jnsougata/deta-go/deta"
)

var d = deta.New(nil)
var drive = d.Drive("filebox")
var instances = d.Base("instances")
var base = d.Base("filebox_metadata")

func main() {
	r := mux.NewRouter()
	r.HandleFunc("/key/{pin}", HandleDetaKey).Methods("GET")
	r.HandleFunc("/metadata", HandleMetadata).Methods("GET", "POST", "DELETE", "PATCH")
	r.HandleFunc("/folder", HandleFolder).Methods("POST")
	r.HandleFunc("/embed/{hash}", HandleEmbed).Methods("GET")
	r.HandleFunc("/shared/{recipient}/{hash}/{skip}", HandleDownload).Methods("GET")
	r.HandleFunc("/shared/metadata/{hash}", HandleSharedMetadata).Methods("GET")
	r.HandleFunc("/query", HandleQuery).Methods("POST")
	r.HandleFunc("/rename", HandleRename).Methods("POST")
	r.HandleFunc("/consumption", HandleSpaceUsage).Methods("GET")
	r.HandleFunc("/pin/{project_id}/{hash}", HandlePin).Methods("POST", "DELETE")
	r.HandleFunc("/file/access", HandleFileAccess).Methods("POST")
	r.HandleFunc("/items/count", HandleFolderItemCountBulk).Methods("POST")
	r.HandleFunc("/bulk/{project_id}", HandleBulkFileOps).Methods("DELETE", "PATCH")
	r.HandleFunc("/items/count", HandleFolderItemCountBulk).Methods("POST")
	r.HandleFunc("/__space/v0/actions", HandleOrphanClenup).Methods("POST")
	r.HandleFunc("/instances", HandleInstances).Methods("POST", "DELETE", "PATCH", "GET")
	r.HandleFunc("/instances/{id}", HandleInstance).Methods("GET", "POST")
	r.HandleFunc("/external/{recipient}/{owner}/{hash}/{skip}", HandleSharedFileLoad).Methods("GET", "POST")
	http.Handle("/", r)
	_ = http.ListenAndServe(":8080", nil)
}

func matchProjectId(id string) bool {
	return strings.HasPrefix(os.Getenv("DETA_API_KEY"), id)
}

func HandleMetadata(w http.ResponseWriter, r *http.Request) {

	switch r.Method {

	case "GET":
		w.Header().Set("Content-Type", "application/json")
		q := deta.NewQuery()
		q.NotEquals("deleted", true)
		resp := base.FetchUntilEnd(q)
		items := resp.Data["items"]
		ba, _ := json.Marshal(items)
		_, _ = w.Write(ba)
		return

	case "POST":
		w.Header().Set("Content-Type", "application/json")
		var data map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&data)
		key := data["hash"].(string)
		data["key"] = key
		_, hasPrent := data["parent"]
		_, isFolder := data["type"]
		if !hasPrent && isFolder {
			q := deta.NewQuery()
			q.Equals("name", data["name"].(string))
			resp := base.FetchUntilEnd(q).Data["items"].([]map[string]interface{})
			var temp []map[string]interface{}
			for _, item := range resp {
				if _, ok := item["parent"]; !ok {
					temp = append(temp, item)
				}
			}
			if len(temp) > 0 {
				w.WriteHeader(http.StatusConflict)
				return
			}
		}
		if hasPrent && isFolder {
			q := deta.NewQuery()
			q.Equals("parent", data["parent"].(string))
			q.Equals("name", data["name"].(string))
			resp := base.FetchUntilEnd(q).Data["items"].([]map[string]interface{})
			if len(resp) > 0 {
				w.WriteHeader(http.StatusConflict)
				return
			}
		}
		resp := base.Put(deta.Record{Key: key, Value: data})
		w.WriteHeader(resp.StatusCode)
		ba, _ := json.Marshal(resp.Data)
		_, _ = w.Write(ba)
		return

	case "PATCH":

		w.Header().Set("Content-Type", "application/json")
		var data map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&data)
		projId, ok := data["project_id"]
		if !ok || !matchProjectId(projId.(string)) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		key := data["hash"].(string)
		data["key"] = key
		resp := base.Put(deta.Record{Key: key, Value: data})
		w.WriteHeader(resp.StatusCode)
		return

	case "DELETE":
		metadata, _ := io.ReadAll(r.Body)
		var file map[string]interface{}
		_ = json.Unmarshal(metadata, &file)
		projId, ok := file["project_id"]
		if !ok || !matchProjectId(projId.(string)) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		_, isFolder := file["type"]
		if isFolder {
			var childrenPath string
			_, hasParent := file["parent"]
			if hasParent {
				childrenPath = fmt.Sprintf("%s/%s", file["parent"].(string), file["name"].(string))
			} else {
				childrenPath = file["name"].(string)
			}
			q := deta.NewQuery()
			q.Equals("parent", childrenPath)
			q.NotEquals("deleted", true)
			resp := base.FetchUntilEnd(q)
			children := resp.Data["items"].([]map[string]interface{})
			if len(children) > 0 {
				w.WriteHeader(http.StatusConflict)
				return
			} else {
				base.Delete(file["hash"].(string))
				w.WriteHeader(http.StatusOK)
				return
			}
		}
		hash := file["hash"].(string)
		_ = base.Delete(hash)
		_ = drive.Delete(fileToDriveSavedName(file))
		w.WriteHeader(http.StatusOK)
		return

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func HandleFolder(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var body map[string]interface{}
	_ = json.NewDecoder(r.Body).Decode(&body)
	parent := body["parent"].(string)
	q := deta.NewQuery()
	q.Equals("parent", parent)
	resp := base.Fetch(q).Data["items"]
	ba, _ := json.Marshal(resp)
	_, _ = w.Write(ba)
}

func HandleEmbed(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	hash := vars["hash"]
	resp := base.Get(hash)
	access, ok := resp.Data["access"]
	if ok && access.(string) == "private" {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if resp.Data["size"].(float64) < 5*1024*1024 {
		fileName := resp.Data["name"].(string)
		mime := resp.Data["mime"].(string)
		w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%s", fileName))
		w.Header().Set("Content-Type", mime)
		extension := strings.Split(fileName, ".")[1]
		streamingResp := drive.Get(fmt.Sprintf("%s.%s", hash, extension))
		content, _ := io.ReadAll(streamingResp.Reader)
		_, _ = w.Write(content)
	}
}

func HandleDownload(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	hash := vars["hash"]
	resp := base.Get(hash)
	recipient := vars["recipient"]
	if recipient == "na" {
		access, ok := resp.Data["access"]
		if ok && access.(string) == "private" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
	} else {
		recipients, ok := resp.Data["recipients"]
		if !ok {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		recipientsList := recipients.([]interface{})
		found := false
		for _, rec := range recipientsList {
			if rec.(string) == recipient {
				found = true
				break
			}
		}
		if !found {
			w.WriteHeader(http.StatusForbidden)
			return
		}
	}
	skip, _ := strconv.Atoi(vars["skip"])
	streamingResp := drive.Get(fileToDriveSavedName(resp.Data))
	ChunkSize := 4 * 1024 * 1024
	content, _ := io.ReadAll(streamingResp.Reader)
	w.Header().Set("Content-Type", "application/octet-stream")
	if (skip+1)*ChunkSize > len(content) {
		_, _ = w.Write(content[skip*ChunkSize:])
		return
	} else {
		_, _ = w.Write(content[skip*ChunkSize : (skip+1)*ChunkSize])
		return
	}
}

func HandleSharedMetadata(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	vars := mux.Vars(r)
	hash := vars["hash"]
	resp := base.Get(hash)
	ba, _ := json.Marshal(resp.Data)
	_, _ = w.Write(ba)
}

func HandleQuery(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var body map[string]interface{}
	_ = json.NewDecoder(r.Body).Decode(&body)
	q := deta.NewQuery()
	for k, v := range body {
		q.Equals(k, v)
	}
	resp := base.FetchUntilEnd(q).Data["items"]
	ba, _ := json.Marshal(resp)
	_, _ = w.Write(ba)
}

func HandleRename(w http.ResponseWriter, r *http.Request) {
	var body map[string]interface{}
	_ = json.NewDecoder(r.Body).Decode(&body)
	u := deta.NewUpdater(body["hash"].(string))
	u.Set("name", body["name"].(string))
	resp := base.Update(u)
	w.WriteHeader(resp.StatusCode)
}

func HandleSpaceUsage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	q := deta.NewQuery()
	q.NotEquals("type", "folder")
	q.NotEquals("shared", true)
	resp := base.FetchUntilEnd(q)
	size := 0
	files := resp.Data["items"].([]map[string]interface{})
	for _, file := range files {
		size += int(file["size"].(float64))
	}
	ba, _ := json.Marshal(map[string]interface{}{"size": size})
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(ba)
}

func HandlePin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	vars := mux.Vars(r)
	hash := vars["hash"]
	projId := vars["project_id"]
	if !matchProjectId(projId) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	switch r.Method {

	case "POST":
		updater := deta.NewUpdater(hash)
		updater.Set("pinned", true)
		resp := base.Update(updater)
		w.WriteHeader(resp.StatusCode)
		return
	case "DELETE":
		updater := deta.NewUpdater(hash)
		updater.Delete("pinned")
		resp := base.Update(updater)
		w.WriteHeader(resp.StatusCode)
		return
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func HandleFileAccess(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var body map[string]interface{}
	_ = json.NewDecoder(r.Body).Decode(&body)
	updater := deta.NewUpdater(body["hash"].(string))
	updater.Set("access", body["access"].(string))
	resp := base.Update(updater)
	w.WriteHeader(resp.StatusCode)
}

func folderToAsParentPath(folder map[string]interface{}) string {
	var path string
	_, ok := folder["parent"]
	if ok {
		path = folder["parent"].(string) + "/" + folder["name"].(string)
	} else {
		path = folder["name"].(string)
	}
	return path
}

func HandleFolderItemCountBulk(w http.ResponseWriter, r *http.Request) {
	var folders []map[string]interface{}
	_ = json.NewDecoder(r.Body).Decode(&folders)
	parentMap := map[string]interface{}{}
	for _, folder := range folders {
		parentMap[folderToAsParentPath(folder)] = map[string]interface{}{
			"hash":  folder["hash"],
			"count": 0,
		}
	}
	q := deta.NewQuery()
	q.Value = []map[string]interface{}{}
	var queries []deta.Query
	for parentPath := range parentMap {
		nq := deta.NewQuery()
		nq.Equals("parent", parentPath)
		nq.NotEquals("deleted", true)
		queries = append(queries, *nq)
	}
	q.Union(queries...)
	resp := base.FetchUntilEnd(q)
	items := resp.Data["items"].([]map[string]interface{})
	for _, item := range items {
		path := item["parent"].(string)
		record, ok := parentMap[path]
		if ok {
			parentMap[path].(map[string]interface{})["count"] = record.(map[string]interface{})["count"].(int) + 1
		}
	}
	counts := []map[string]interface{}{}
	for _, v := range parentMap {
		counts = append(counts, v.(map[string]interface{}))
	}
	ba, _ := json.Marshal(counts)
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(ba)
}

func fileToDriveSavedName(file map[string]interface{}) string {
	hash := file["hash"].(string)
	fragment := strings.Split(file["name"].(string), ".")
	var driveFilename string
	if len(fragment) > 1 {
		driveFilename = fmt.Sprintf("%s.%s", hash, fragment[len(fragment)-1])
	} else {
		driveFilename = hash
	}
	return driveFilename
}

func HandleBulkFileOps(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	projId := vars["project_id"]
	if !matchProjectId(projId) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	switch r.Method {
	case "DELETE":
		var body []map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		var hashes []string
		var driveNames []string
		for _, item := range body {
			hashes = append(hashes, item["hash"].(string))
			driveNames = append(driveNames, fileToDriveSavedName(item))
		}
		base.Delete(hashes...)
		drive.Delete(driveNames...)
		w.WriteHeader(http.StatusOK)
		return
	case "PATCH":
		var body []map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		var files []deta.Record
		for _, item := range body {
			record := deta.Record{Key: item["hash"].(string), Value: item}
			files = append(files, record)
		}
		base.Put(files...)
		w.WriteHeader(http.StatusOK)
	}
}

func HandleDetaKey(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	pin := vars["pin"]
	userPin := os.Getenv("USER_PIN")
	if userPin == "" {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if len(pin) > 4 {
		pin = pin[:4]
	}
	if pin != os.Getenv("USER_PIN") {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	data := map[string]interface{}{
		"key": os.Getenv("DETA_API_KEY"),
	}
	ba, _ := json.Marshal(data)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(ba)
}

func HandleOrphanClenup(w http.ResponseWriter, _ *http.Request) {
	data := drive.Files("", 0, "").Data
	names := data["names"].([]interface{})
	hashes := map[string]string{}
	for _, name := range names {
		fragments := strings.Split(name.(string), ".")
		if len(fragments) > 1 {
			hashes[fragments[0]] = name.(string)
		} else {
			hashes[name.(string)] = name.(string)
		}
	}
	var orphanNames []string
	for k, v := range hashes {
		resp := base.Get(k).Data
		_, ok := resp["hash"]
		if !ok {
			orphanNames = append(orphanNames, v)
		}
	}
	drive.Delete(orphanNames...)
}

func HandleInstances(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	switch r.Method {
	case "GET":
		resp := instances.FetchUntilEnd(deta.NewQuery())
		w.WriteHeader(resp.StatusCode)
		ba, _ := json.Marshal(resp.Data["items"])
		_, _ = w.Write(ba)
		return

	case "POST":
		var body map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		resp := instances.Put(deta.Record{Key: body["id"].(string), Value: body})
		w.WriteHeader(resp.StatusCode)
		return
		
	case "DELETE":
		var body map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		resp := instances.Delete(body["id"].(string))
		w.WriteHeader(resp.StatusCode)
		return
	}
}

func HandleInstance(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	vars := mux.Vars(r)
	switch r.Method {
	case "GET":
		resp := instances.Get(vars["id"])
		w.WriteHeader(resp.StatusCode)
		ba, _ := json.Marshal(resp.Data)
		_, _ = w.Write(ba)
		return

	case "POST":
		instanceData := instances.Get(vars["id"]).Data
		_, ok := instanceData["id"]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		url := instanceData["url"].(string)
		apiKey := instanceData["api_key"].(string)
		req, err := http.NewRequest("POST", fmt.Sprintf("%s/api/metadata", url), r.Body)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		req.Header.Set("X-Space-App-Key", apiKey)
		req.Header.Set("Content-Type", "application/json")
		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		defer resp.Body.Close()
		w.WriteHeader(resp.StatusCode)
		return
	}
}

func HandleSharedFileLoad(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	owner := vars["owner"]
	recipient := vars["recipient"]
	hash := vars["hash"]
	skip := vars["skip"]
	ownerData := instances.Get(owner).Data
	ownerInstanceUrl := ownerData["url"].(string)
	ownerInstanceApiKey := ownerData["api_key"].(string)
	req, err := http.NewRequest(
		"GET",
		fmt.Sprintf("%s/api/shared/%s/%s/%s", ownerInstanceUrl, recipient, hash, skip),
		nil)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	req.Header.Set("X-Space-App-Key", ownerInstanceApiKey)
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.WriteHeader(resp.StatusCode)
	ba, _ := io.ReadAll(resp.Body)
	w.Write(ba)
}
