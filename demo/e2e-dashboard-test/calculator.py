import argparse
import sys

def add(x, y):
    return x + y

def sub(x, y):
    return x - y

def mul(x, y):
    return x * y

def div(x, y):
    if y == 0:
        raise ValueError("Cannot divide by zero")
    return x / y

def main():
    parser = argparse.ArgumentParser(description="Simple CLI Calculator")
    parser.add_argument("operation", choices=["add", "sub", "mul", "div"], help="Operation to perform")
    parser.add_argument("x", type=float, help="First number")
    parser.add_argument("y", type=float, help="Second number")

    args = parser.parse_args()

    try:
        if args.operation == "add":
            result = add(args.x, args.y)
        elif args.operation == "sub":
            result = sub(args.x, args.y)
        elif args.operation == "mul":
            result = mul(args.x, args.y)
        elif args.operation == "div":
            result = div(args.x, args.y)
        
        print(result)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
