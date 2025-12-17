from app.app import app

if __name__ == '__main__':
    print("🚀 AI Service starting on Port 5001...")
    app.run(port=5001, debug=True)