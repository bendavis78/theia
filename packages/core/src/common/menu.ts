/********************************************************************************
 * Copyright (C) 2017 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { injectable, inject, named } from 'inversify';
import { Disposable } from './disposable';
import { CommandRegistry, Command } from './command';
import { ContributionProvider } from './contribution-provider';

export interface MenuAction {
    commandId: string
    /**
     * In addition to the mandatory command property, an alternative command can be defined.
     * It will be shown and invoked when pressing Alt while opening a menu.
     */
    alt?: string;
    label?: string
    icon?: string
    order?: string
    when?: string
}

export namespace MenuAction {
    /* Determine whether object is a MenuAction */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export function is(arg: MenuAction | any): arg is MenuAction {
        return !!arg && arg === Object(arg) && 'commandId' in arg;
    }
}

export interface SubMenuOptions {
    iconClass?: string
    order?: string
}

export type MenuPath = string[];

export const MAIN_MENU_BAR: MenuPath = ['menubar'];

export const SETTINGS_MENU: MenuPath = ['settings_menu'];
export const ACCOUNTS_MENU: MenuPath = ['accounts_menu'];
export const ACCOUNTS_SUBMENU = [...ACCOUNTS_MENU, '1_accounts_submenu'];

export const MenuContribution = Symbol('MenuContribution');

/**
 * Representation of a menu contribution.
 */
export interface MenuContribution {
    /**
     * Registers menus.
     * @param menus the menu model registry.
     */
    registerMenus(menus: MenuModelRegistry): void;
}

@injectable()
export class MenuModelRegistry {
    protected readonly root = new CompositeMenuNode('');
    protected readonly onDidRegisterEmitter = new Emitter<void>();

    constructor(
        @inject(ContributionProvider) @named(MenuContribution)
        protected readonly contributions: ContributionProvider<MenuContribution>,
        @inject(CommandRegistry) protected readonly commands: CommandRegistry
    ) { }

    onStart(): void {
        for (const contrib of this.contributions.getContributions()) {
            contrib.registerMenus(this);
        }
    }

    registerMenuAction(menuPath: MenuPath, item: MenuAction): Disposable {
        const menuNode = new ActionMenuNode(item, this.commands);
        return this.registerMenuNode(menuPath, menuNode);
    }

    registerMenuNode(menuPath: MenuPath, menuNode: MenuNode): Disposable {
        const parent = this.findGroup(menuPath);
        const disposable = parent.addNode(menuNode);
        this.onDidRegisterEmitter.fire(undefined);
        return disposable;
    }

    registerSubmenu(menuPath: MenuPath, label: string, options?: SubMenuOptions): Disposable {
        if (menuPath.length === 0) {
            throw new Error('The sub menu path cannot be empty.');
        }
        const index = menuPath.length - 1;
        const menuId = menuPath[index];
        const groupPath = index === 0 ? [] : menuPath.slice(0, index);
        const parent = this.findGroup(groupPath, options);
        let groupNode = this.findSubMenu(parent, menuId, options);
        if (!groupNode) {
            groupNode = new CompositeMenuNode(menuId, label, options);
            return parent.addNode(groupNode);
        } else {
            if (!groupNode.label) {
                groupNode.label = label;
            } else if (groupNode.label !== label) {
                throw new Error("The group '" + menuPath.join('/') + "' already has a different label.");
            }
            if (options) {
                if (!groupNode.iconClass) {
                    groupNode.iconClass = options.iconClass;
                }
                if (!groupNode.order) {
                    groupNode.order = options.order;
                }
            }
            return { dispose: () => { } };
        }
    }

    /**
     * Unregister menu item from the registry
     *
     * @param item
     */
    unregisterMenuAction(item: MenuAction, menuPath?: MenuPath): void;
    /**
     * Unregister menu item from the registry
     *
     * @param command
     */
    unregisterMenuAction(command: Command, menuPath?: MenuPath): void;
    /**
     * Unregister menu item from the registry
     *
     * @param id
     */
    unregisterMenuAction(id: string, menuPath?: MenuPath): void;
    unregisterMenuAction(itemOrCommandOrId: MenuAction | Command | string, menuPath?: MenuPath): void {
        const id = MenuAction.is(itemOrCommandOrId) ? itemOrCommandOrId.commandId
            : Command.is(itemOrCommandOrId) ? itemOrCommandOrId.id
                : itemOrCommandOrId;

        if (menuPath) {
            const parent = this.findGroup(menuPath);
            parent.removeNode(id);
            return;
        }

        this.unregisterMenuNode(id);
    }

    /**
     * Recurse all menus, removing any menus matching the `id`.
     * @param id technical identifier of the `MenuNode`.
     */
    unregisterMenuNode(id: string): void {
        const recurse = (root: CompositeMenuNode) => {
            root.children.forEach(node => {
                if (node instanceof CompositeMenuNode) {
                    node.removeNode(id);
                    recurse(node);
                }
            });
        };
        recurse(this.root);
    }

    protected findGroup(menuPath: MenuPath, options?: SubMenuOptions): CompositeMenuNode {
        let currentMenu = this.root;
        for (const segment of menuPath) {
            currentMenu = this.findSubMenu(currentMenu, segment, options);
        }
        return currentMenu;
    }

    protected findSubMenu(current: CompositeMenuNode, menuId: string, options?: SubMenuOptions): CompositeMenuNode {
        const sub = current.children.find(e => e.id === menuId);
        if (sub instanceof CompositeMenuNode) {
            return sub;
        }
        if (sub) {
            throw new Error(`'${menuId}' is not a menu group.`);
        }
        const newSub = new CompositeMenuNode(menuId, undefined, options);
        current.addNode(newSub);
        return newSub;
    }

    getMenu(menuPath: MenuPath = []): CompositeMenuNode {
        return this.findGroup(menuPath);
    }

    get onDidRegister(): Event<void> {
        return this.onDidRegisterEmitter.event;
    }
}

export interface MenuNode {
    readonly label?: string
    /**
     * technical identifier
     */
    readonly id: string

    readonly sortString: string
}

export class CompositeMenuNode implements MenuNode {
    protected readonly _children: MenuNode[] = [];
    public iconClass?: string;
    public order?: string;

    constructor(
        public readonly id: string,
        public label?: string,
        options?: SubMenuOptions
    ) {
        if (options) {
            this.iconClass = options.iconClass;
            this.order = options.order;
        }
    }

    get children(): ReadonlyArray<MenuNode> {
        return this._children;
    }

    public addNode(node: MenuNode): Disposable {
        this._children.push(node);
        this._children.sort((m1, m2) => {
            // The navigation group is special as it will always be sorted to the top/beginning of a menu.
            if (CompositeMenuNode.isNavigationGroup(m1)) {
                return -1;
            }
            if (CompositeMenuNode.isNavigationGroup(m2)) {
                return 1;
            }
            if (m1.sortString < m2.sortString) {
                return -1;
            } else if (m1.sortString > m2.sortString) {
                return 1;
            } else {
                return 0;
            }
        });
        return {
            dispose: () => {
                const idx = this._children.indexOf(node);
                if (idx >= 0) {
                    this._children.splice(idx, 1);
                }
            }
        };
    }

    public removeNode(id: string): void {
        const node = this._children.find(n => n.id === id);
        if (node) {
            const idx = this._children.indexOf(node);
            if (idx >= 0) {
                this._children.splice(idx, 1);
            }
        }
    }

    get sortString(): string {
        return this.order || this.id;
    }

    get isSubmenu(): boolean {
        return this.label !== undefined;
    }

    static isNavigationGroup(node: MenuNode): node is CompositeMenuNode {
        return node instanceof CompositeMenuNode && node.id === 'navigation';
    }
}

export class ActionMenuNode implements MenuNode {

    readonly altNode: ActionMenuNode | undefined;

    constructor(
        public readonly action: MenuAction,
        protected readonly commands: CommandRegistry
    ) {
        if (action.alt) {
            this.altNode = new ActionMenuNode({ commandId: action.alt }, commands);
        }
    }

    get id(): string {
        return this.action.commandId;
    }

    get label(): string {
        if (this.action.label) {
            return this.action.label;
        }
        const cmd = this.commands.getCommand(this.action.commandId);
        if (!cmd) {
            throw new Error(`A command with id '${this.action.commandId}' does not exist.`);
        }
        return cmd.label || cmd.id;
    }

    get icon(): string | undefined {
        if (this.action.icon) {
            return this.action.icon;
        }
        const command = this.commands.getCommand(this.action.commandId);
        return command && command.iconClass;
    }

    get sortString(): string {
        return this.action.order || this.label;
    }
}
