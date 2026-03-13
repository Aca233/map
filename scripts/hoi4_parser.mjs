import fs from 'fs';
import path from 'fs';

/**
 * A generic parser for Hearts of Iron IV (HOI4) script files (.txt).
 * Converts HOI4's custom syntax into standard JSON objects.
 */
export class Hoi4Parser {
    /**
     * Parses a HOI4 script string into a JavaScript object.
     * @param {string} content The raw text content of the HOI4 file.
     * @returns {object} The parsed JavaScript object.
     */
    static parse(content) {
        // 1. Pre-processing: Remove comments and normalize whitespace
        let cleaned = content
            .replace(/#.*$/gm, '') // Remove comments starting with #
            .replace(/\r\n/g, '\n') // Normalize line endings
            .trim();

        // 2. Tokenization
        // We need to split by whitespace, but keep quoted strings together
        // and treat =, {, } as separate tokens.
        const tokens = [];
        const regex = /"([^"\\]*(\\.[^"\\]*)*)"|([={}])|([^\s={}]+)/g;
        let match;
        while ((match = regex.exec(cleaned)) !== null) {
            if (match[1] !== undefined) {
                // Quoted string
                tokens.push(`"${match[1]}"`);
            } else if (match[3] !== undefined) {
                // Operator =, {, }
                tokens.push(match[3]);
            } else if (match[4] !== undefined) {
                // Unquoted string/number
                tokens.push(match[4]);
            }
        }

        // 3. Parsing
        let pos = 0;

        function parseValue() {
            if (pos >= tokens.length) return null;
            const token = tokens[pos];

            if (token === '{') {
                return parseBlock();
            } else {
                pos++;
                // Try to parse as number if possible, otherwise keep as string
                // Remove quotes if it's a quoted string
                let val = token;
                if (val.startsWith('"') && val.endsWith('"')) {
                    val = val.substring(1, val.length - 1);
                } else if (!isNaN(Number(val))) {
                    val = Number(val);
                }
                return val;
            }
        }

        function parseBlock() {
            pos++; // Skip '{'
            const obj = {};
            const arr = [];
            let isArray = false;
            let isObject = false;

            while (pos < tokens.length && tokens[pos] !== '}') {
                const token = tokens[pos];

                // Look ahead to see if it's a key-value pair
                if (pos + 1 < tokens.length && tokens[pos + 1] === '=') {
                    isObject = true;
                    const key = token.replace(/^"|"$/g, ''); // Remove quotes from key if any
                    pos += 2; // Skip key and '='
                    const value = parseValue();
                    
                    // Handle duplicate keys by converting to array
                    if (obj.hasOwnProperty(key)) {
                        if (!Array.isArray(obj[key])) {
                            obj[key] = [obj[key]];
                        }
                        obj[key].push(value);
                    } else {
                        obj[key] = value;
                    }
                } else {
                    // It's an array element
                    isArray = true;
                    arr.push(parseValue());
                }
            }
            pos++; // Skip '}'

            // If a block has both key-value pairs and array elements, 
            // HOI4 usually treats it as an object where array elements might be implicit keys or just a list.
            // For simplicity, if it has any key-value pairs, we return the object.
            // If it only has array elements, we return the array.
            // If it's empty, return empty object.
            if (isObject && isArray) {
                // Mixed block, attach array elements to a special key
                obj['_list'] = arr;
                return obj;
            } else if (isArray) {
                return arr;
            } else {
                return obj;
            }
        }

        // The root of a HOI4 file is essentially an implicit block
        const root = {};
        while (pos < tokens.length) {
            const keyToken = tokens[pos];
            if (pos + 1 < tokens.length && tokens[pos + 1] === '=') {
                const key = keyToken.replace(/^"|"$/g, '');
                pos += 2;
                const value = parseValue();
                if (root.hasOwnProperty(key)) {
                    if (!Array.isArray(root[key])) {
                        root[key] = [root[key]];
                    }
                    root[key].push(value);
                } else {
                    root[key] = value;
                }
            } else {
                // Unexpected token at root level without '=', skip or handle
                pos++;
            }
        }

        return root;
    }

    /**
     * Parses a HOI4 script file and returns a JSON object.
     * @param {string} filePath Path to the .txt file.
     * @returns {object} The parsed JSON object.
     */
    static parseFile(filePath) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return this.parse(content);
    }
}

// If run directly, test the parser
import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const testScript = `
    # This is a comment
    country = {
        name = "Germany"
        tag = GER
        color = { 10 20 30 }
        ideology = fascism
        leaders = {
            "Adolf Hitler"
            "Hermann Göring"
        }
        ideas = {
            idea1 = yes
            idea2 = no
        }
    }
    `;
    console.log("Testing Parser...");
    const result = Hoi4Parser.parse(testScript);
    console.log(JSON.stringify(result, null, 2));
}
