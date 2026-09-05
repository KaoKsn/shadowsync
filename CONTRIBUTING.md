# Contribution Guide

## Branch and Pull Request Guidelines

**Don't** directly work on the `main` branch, and don't push directly to it.

Contributors who are not project maintainers must not make changes directly to the `release` branch. Please work on a separate feature or fix branch and submit a pull request targeting `main` branch for review.

## Collaborators

1. Create a separate branch for your work with a descriptive name.
2. Make and test your changes locally.
3. Push the branch to the remote repository.
4. Open a pull request targeting the `main` branch.

>Directly merging into `main` should only be done with approval from the project's maintainers.

## External Contributors

1. Fork this repository.
2. Create a feature branch in your fork. Use descriptive names such as:
    - `feature/help`
    - `docs/contributing-guide`
    - `fix/buffer-overflow`
3. Make the changes and commit them under your **own** name and email address.
4. Push the changes to your fork.
5. Open a pull request targeting repository's the `main` branch.

## Commit Guidelines

>Keep the commit message subject short and crisp. Add further details in commit message body if necessary.

Use the following format:
```text
<type>(<scope>): <short description>

    <additional details>

Fixes #<issue-number> [optional/if it applies]
```

Example:
```text
fix(runners): a buffer overflow in the function foo() that allowed for RCE

    Prevent a buffer overflow in foo() that could allow remote code execution.

    Add regression tests covering the vulnerable input and ensuring thatthe function handles oversized data safely.

Fixes Issue: #13
```

## Liability and Responsibility

You are responsible to the code you write and the changes you make.
Therefore commits must be done under the contributor's name and under AI tool's name.

You can mention(the name) of the AI tool used if you wish to in the commit message.
Do not impersonate another contributor.

>Thank you for contributing!

Regards,<br>
Team `shadowsync`
