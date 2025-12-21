# Go Vulnerabilities

## SQL Injection
```go
// VULNERABLE
query := fmt.Sprintf("SELECT * FROM users WHERE id = %s", userID)
db.Query(query)

// SAFE - parameterized
db.Query("SELECT * FROM users WHERE id = $1", userID)
db.QueryRow("SELECT * FROM users WHERE id = ?", userID)
```

## Command Injection
```go
// VULNERABLE
cmd := exec.Command("sh", "-c", "echo " + userInput)
cmd.Run()

// SAFE - no shell, array args
cmd := exec.Command("echo", userInput)
cmd.Run()
```

## Path Traversal
```go
// VULNERABLE
path := filepath.Join(baseDir, userFilename)
ioutil.ReadFile(path)

// SAFE
basePath, _ := filepath.Abs(baseDir)
targetPath, _ := filepath.Abs(filepath.Join(baseDir, userFilename))
if !strings.HasPrefix(targetPath, basePath) {
    return errors.New("path traversal detected")
}
```

## Insecure TLS
```go
// VULNERABLE - skip verification
tr := &http.Transport{
    TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
}

// SAFE - proper verification
tr := &http.Transport{
    TLSClientConfig: &tls.Config{
        MinVersion: tls.VersionTLS12,
    },
}
```

## Race Conditions
```go
// VULNERABLE - data race
var counter int
go func() { counter++ }()
go func() { counter++ }()

// SAFE - mutex or atomic
var counter int64
go func() { atomic.AddInt64(&counter, 1) }()
go func() { atomic.AddInt64(&counter, 1) }()

// Or use sync.Mutex
var mu sync.Mutex
go func() {
    mu.Lock()
    counter++
    mu.Unlock()
}()
```

## Integer Overflow
```go
// VULNERABLE - can overflow
func allocate(size int) []byte {
    return make([]byte, size*2)  // Can wrap negative
}

// SAFE - bounds check
func allocate(size int) ([]byte, error) {
    if size <= 0 || size > maxSize {
        return nil, errors.New("invalid size")
    }
    return make([]byte, size*2), nil
}
```

## Information Disclosure
```go
// VULNERABLE - stack trace to user
http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    defer func() {
        if err := recover(); err != nil {
            http.Error(w, fmt.Sprintf("%v", err), 500)  // Exposes internals
        }
    }()
})

// SAFE - log internally, generic response
defer func() {
    if err := recover(); err != nil {
        log.Printf("panic: %v", err)
        http.Error(w, "Internal Server Error", 500)
    }
}()
```

## Template Injection
```go
// VULNERABLE - text/template doesn't escape
import "text/template"
t := template.Must(template.New("page").Parse(`<h1>{{.Name}}</h1>`))

// SAFE - html/template auto-escapes
import "html/template"
t := template.Must(template.New("page").Parse(`<h1>{{.Name}}</h1>`))
```
