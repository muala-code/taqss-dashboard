from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
print("Taqss Dashboard: http://localhost:8080")
ThreadingHTTPServer(("127.0.0.1", 8080), SimpleHTTPRequestHandler).serve_forever()
