import json
import os
import shutil
import re
import re
import os


def find_readmes(root_dir):
    """Recursively find all README.md files in the directory."""
    readmes = []
    for dirpath, _, filenames in os.walk(root_dir):
        if not 'node_modules' in dirpath:
            for file in filenames:
                if file.lower() == "readme.md":
                    readmes.append(os.path.join(dirpath, file))
    return readmes


def find_package_jsons(root_dir):
    """Recursively find all package.json files in the directory."""
    package_jsons = []
    for dirpath, _, filenames in os.walk(root_dir):
        if not 'node_modules' in dirpath:
            for file in filenames:
                if file.lower() == "package.json":
                    package_jsons.append(os.path.join(dirpath, file))
    return package_jsons


def find_rollup_configs(root_dir):
    """Recursively find all rollup.config.js files in the directory."""
    rollup_configs = []
    for dirpath, _, filenames in os.walk(root_dir):
        if not 'node_modules' in dirpath:
            for file in filenames:
                if file.lower() == "rollup.config.mjs":
                    rollup_configs.append(os.path.join(dirpath, file))
    return rollup_configs


def find_examples(root_dir):
    examples = []
    for dirpath, _, filenames in os.walk(root_dir):
        if not 'node_modules' in dirpath:
            if dirpath.endswith("examples"):
                for file in filenames:
                    examples.append(os.path.join(dirpath, file))
    return examples


def find_additional_docs(root_dir):
    examples = []
    for dirpath, _, filenames in os.walk(root_dir):
        if not 'node_modules' in dirpath:
            if dirpath.endswith("docs"):
                for file in filenames:
                    examples.append(os.path.join(dirpath, file))
    return examples


def find_plugin_code(root_dir):
    plugin_code = []
    for dirpath, _, filenames in os.walk(root_dir):
        if not 'node_modules' in dirpath:
            if dirpath.endswith("src"):
                for file in filenames:
                    if file.endswith("index.ts"):
                        plugin_code.append(os.path.join(dirpath, file))
    return plugin_code


def copy_files_and_generate_nav(readmes, output_dir, root_dir):
    """Copy README files to the output directory and generate an index file."""
    os.makedirs(output_dir, exist_ok=True)
    nav = []

    for package_file, rollup_file in zip(find_package_jsons(root_dir), find_rollup_configs(root_dir)):
        content = create_readme_from_package_json(package_file, rollup_file)
        relative_dir = os.path.relpath(os.path.dirname(package_file), root_dir)
        output_path = os.path.join(output_dir, relative_dir, "index.md")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "a") as f:
            f.write(content)
        link_name = relative_dir.replace("_", " ").replace('-', ' ')
        link_name = " ".join(word.capitalize() for word in link_name.split())
        nav.append({"name": link_name, "path": relative_dir})

    return nav


def create_mkdocs_yaml(nav):
    content = """site_name: Sweet JsPsych
theme:
  name: material
  palette:
    - scheme: default
      primary: black
      toggle:
        icon: material/brightness-7
        name: Switch to dark mode

    - scheme: slate
      primary: black
      toggle:
        icon: material/brightness-4
        name: Switch to light mode
  features:
    - navigation.indexes
    - content.code.copy
    - announce.dismiss
nav:
    - Home: index.md
"""
    for section in nav:
        content += f"    - {section['name']}: {section['path']}\n"
    with open("../../mkdocs.yml", "w") as f:
        f.write(content)


def extract_rollup_config_with_regex(rollup_config_path):
    """Extract information from rollup.config.mjs using regex."""

    with open(rollup_config_path, "r") as file:
        config_content = file.read()

    # Regex to match the `input` file
    input_match = re.search(r"input\s*:\s*['\"](.*?)['\"]", config_content)

    # Regex to match the `name` property in the output section
    name_match = re.search(r"name\s*:\s*['\"](.*?)['\"]", config_content)

    # Regex to match all output file paths
    output_matches = re.findall(r"file\s*:\s*['\"](.*?)['\"]", config_content)

    # Return the extracted data
    return {
        "input": input_match.group(1) if input_match else "Not specified",
        "name": name_match.group(1) if name_match else "Not specified",
        "outputs": output_matches if output_matches else []
    }


def create_readme_from_package_json(package_json, rollup_config):
    """Generate a README.md file from a package.json file."""
    with open(package_json, "r") as f:
        package_data = json.load(f)

    rollup_data = extract_rollup_config_with_regex(rollup_config)

    # Extract details from package.json
    name = package_data.get("name", "Unnamed Package")
    description = package_data.get("description", "No description provided.")
    version = package_data.get("version", "0.0.0")

    # Extract details from rollup.config.js
    class_name = rollup_data.get("name", "Not specifie")

    title = name[22:].replace("_", " ").replace('-', ' ')

    # Create README content
    return f"""
## Loading

### In browser

```js
<script src="https://unpkg.com/{name}@{version}"></script>
```

### Via NPM

```
npm install {name}
```

```js
import {class_name} from '{name}';
```

## Compatibility

jsPsych 7.0.0
"""


def create_site_from_code(plugin_code):
    # Input: Plugin Code

    # Extract Plugin Metadata
    plugin_name = re.search(r'@plugin\s*(.*?)\n', plugin_code).group(1)
    plugin_description = re.search(r'@description\s*(.*?)\n', plugin_code).group(1)
    plugin_author = re.search(r'@author\s(.*?)\n', plugin_code, re.DOTALL).group(1).strip()

    # Extract Parameters
    parameters_block = re.search(r'parameters:\s*{(.*)}', plugin_code, re.DOTALL).group(1)
    parameter_matches = re.finditer(
        r'/\*\*(.*?)\*/\s*(\w+):\s*{\s*type:\s*(ParameterType\.\w+),\s*default:\s*(\[.*?\]|null|true|false|".*?"|\d+)',
        parameters_block,
        re.DOTALL,
    )

    parameters = []
    for match in parameter_matches:
        description = match.group(1).strip().replace("*", "").replace("\n", " ")
        name = match.group(2)
        param_type = match.group(3).replace("ParameterType.", "")
        default = match.group(4).strip()
        parameters.append({"name": name, "type": param_type, "default": default, "description": description})

    # Generate Markdown Table
    parameters_table = "| Name          | Type     | Default       | Description |\n"
    parameters_table += "|---------------|----------|---------------|-------------|\n"
    for param in parameters:
        parameters_table += f"| {param['name']} | {param['type']} | {str(param['default'])} | {param['description']} |\n"

    # Extract Data
    data_block = re.search(r'data:\s*{(.*)}', plugin_code, re.DOTALL).group(1)
    data_matches = re.finditer(
        r'/\*\*(.*?)\*/\s*(\w+):\s*{\s*type:\s*(ParameterType\.\w+)',
        data_block,
        re.DOTALL,
    )

    # Process data fields
    data_fields = []
    for match in data_matches:
        description = match.group(1).strip().replace("*", "").replace("\n", " ")
        name = match.group(2)
        data_type = match.group(3).replace("ParameterType.", "")
        data_fields.append({"name": name, "type": data_type, "description": description})

    # Generate Markdown Table
    data_table = "| Name         | Type     | Description |\n"
    data_table += "|--------------|----------|-------------|\n"
    for field in data_fields:
        data_table += f"| {field['name']} | {field['type']} | {field['description']} |\n"

    # Generate Markdown Documentation
    doc_lines = [
        f"# {plugin_name} - {plugin_author}",
        "",
        plugin_description,
        "",
        "## Parameters",
        "",
        parameters_table,
        "",
        "## Data Output",
        "",
        data_table,
    ]

    return "\n".join(doc_lines)


def create_sites_from_code(root_dir):
    for path in find_plugin_code(root_dir):
        txt = open(path, 'r').read()
        content = create_site_from_code(txt)
        relative_dir = os.path.relpath(os.path.dirname(path), root_dir)

        output_path = os.path.join("../../docs", relative_dir[:-4], "index.md")
        with open(output_path, "w") as f:
            f.write(content)


def add_examples(root_dir):
    for path in find_examples(root_dir):
        relative_dir = os.path.relpath(os.path.dirname(path), root_dir)
        output_path = os.path.join("../../docs", relative_dir[:-9], "index.md")
        with open(output_path, "a") as f:
            if '## Examples' not in open(output_path, 'r').read():
                f.write(f"\n\n## Examples\n\n```html\n{open(path, 'r').read()}\n```")
            else:
                f.write(f"\n\n```html\n{open(path, 'r').read()}\n```")


def add_additional_docs(root_dir):
    for path in find_additional_docs(root_dir):
        relative_dir = os.path.relpath(os.path.dirname(path), root_dir)
        output_path = os.path.join("../../docs", relative_dir[:-4], "index.md")
        with open(output_path, "a") as f:
            f.write(f"\n\n{open(path, 'r').read()}\n")


def main():
    # Define directories
    root_dir = "../../plugins"
    output_dir = "../../docs"

    # Find all README.md files
    readmes = find_readmes(root_dir)
    if not readmes:
        print("No README.md files found.")
        return
    create_sites_from_code(root_dir)

    # Generate the documentation
    nav = copy_files_and_generate_nav(readmes, output_dir, root_dir)
    create_mkdocs_yaml(nav)
    add_additional_docs(root_dir)
    add_examples(root_dir)


if __name__ == "__main__":
    main()
